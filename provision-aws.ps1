#requires -Version 5.1
<#
.SYNOPSIS
    AWS Infrastructure Provisioning Script for xtend-financial-static
    Region: af-south-1
#>

$ErrorActionPreference = "Stop"

$REGION = "af-south-1"
$INSTANCE_NAME = "xtend-financial-static"
$INSTANCE_TYPE = "t3.micro"
$AMI_NAME = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
$KEY_NAME = "guud-fleet-staging-key"
$VOLUME_SIZE = 20

function Write-Step($n, $total, $msg) {
    Write-Host "`n[Step $n/$total] $msg" -ForegroundColor Yellow
}

function Write-Success($msg) {
    Write-Host "  OK: $msg" -ForegroundColor Green
}

function Write-Info($msg) {
    Write-Host "  $msg" -ForegroundColor Cyan
}

function Write-Warn($msg) {
    Write-Host "  WARN: $msg" -ForegroundColor DarkYellow
}

function Write-Error($msg) {
    Write-Host "  ERROR: $msg" -ForegroundColor Red
}

# ═══════════════════════════════════════════════════════════════════════════
# 1. Verify AWS CLI
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 1 7 "Checking AWS CLI authentication..."

$awsCmd = Get-Command aws -ErrorAction SilentlyContinue
if (-not $awsCmd) {
    Write-Error "AWS CLI is not installed or not in PATH."
    Write-Host "Install from: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html" -ForegroundColor Red
    exit 1
}

try {
    $caller = aws sts get-caller-identity --output json | ConvertFrom-Json
    $ACCOUNT_ID = $caller.Account
    Write-Success "Authenticated (Account: $ACCOUNT_ID)"
} catch {
    Write-Error "Not authenticated with AWS."
    Write-Host "`nRun:  aws sso login --profile PowerUserAccess-491598972312" -ForegroundColor Yellow
    Write-Host "`nOr configure SSO first:" -ForegroundColor Yellow
    Write-Host "  aws configure sso" -ForegroundColor Yellow
    Write-Host "  SSO start URL: https://d-90671c5d83.awsapps.com/start" -ForegroundColor Yellow
    Write-Host "  SSO region:    eu-west-1" -ForegroundColor Yellow
    Write-Host "  Account ID:    491598972312" -ForegroundColor Yellow
    Write-Host "  Role name:     PowerUserAccess" -ForegroundColor Yellow
    exit 1
}

# ═══════════════════════════════════════════════════════════════════════════
# 2. Find Ubuntu 22.04 AMI
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 2 7 "Finding Ubuntu 22.04 AMI..."

$amiJson = aws ec2 describe-images `
    --region $REGION `
    --owners 099720109477 `
    --filters "Name=name,Values=$AMI_NAME" `
              "Name=virtualization-type,Values=hvm" `
              "Name=architecture,Values=x86_64" `
    --query 'Images | sort_by(@, &CreationDate) | [-1].[ImageId,Name]' `
    --output json 2>$null | ConvertFrom-Json

if (-not $amiJson -or $amiJson.Count -eq 0) {
    Write-Error "Could not find Ubuntu 22.04 AMI in $REGION"
    exit 1
}

$AMI_ID = $amiJson[0]
$AMI_NAME_FOUND = $amiJson[1]
Write-Success "AMI found: $AMI_ID ($AMI_NAME_FOUND)"

# ═══════════════════════════════════════════════════════════════════════════
# 3. Find VPC
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 3 7 "Finding VPC..."

# Try GUUD Fleet VPC first
$vpcJson = aws ec2 describe-vpcs `
    --region $REGION `
    --filters "Name=tag:Name,Values=guud-fleet-staging-vpc" `
    --query 'Vpcs[0].VpcId' `
    --output text 2>$null

if ($vpcJson -and $vpcJson -ne "None") {
    $VPC_ID = $vpcJson
    Write-Success "Using existing GUUD Fleet VPC: $VPC_ID"
} else {
    # Fall back to default VPC
    $vpcJson = aws ec2 describe-vpcs `
        --region $REGION `
        --filters "Name=isDefault,Values=true" `
        --query 'Vpcs[0].VpcId' `
        --output text 2>$null

    if ($vpcJson -and $vpcJson -ne "None") {
        $VPC_ID = $vpcJson
        Write-Success "Using default VPC: $VPC_ID"
    } else {
        Write-Warn "No default VPC. Creating new VPC..."
        $vpcResult = aws ec2 create-vpc `
            --region $REGION `
            --cidr-block 10.0.0.0/16 `
            --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$INSTANCE_NAME-vpc}]" `
            --query 'Vpc.VpcId' `
            --output text
        $VPC_ID = $vpcResult
        aws ec2 modify-vpc-attribute --region $REGION --vpc-id $VPC_ID --enable-dns-hostnames | Out-Null
        Write-Success "Created VPC: $VPC_ID"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# 4. Find or Create Subnet
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 4 7 "Finding public subnet..."

$subnetJson = aws ec2 describe-subnets `
    --region $REGION `
    --filters "Name=vpc-id,Values=$VPC_ID" `
              "Name=map-public-ip-on-launch,Values=true" `
    --query 'Subnets[0].SubnetId' `
    --output text 2>$null

if ($subnetJson -and $subnetJson -ne "None") {
    $SUBNET_ID = $subnetJson
    Write-Success "Using subnet: $SUBNET_ID"
} else {
    Write-Warn "No public subnet found. Creating one..."

    $az = aws ec2 describe-availability-zones `
        --region $REGION `
        --query 'AvailabilityZones[0].ZoneName' `
        --output text

    $subnetResult = aws ec2 create-subnet `
        --region $REGION `
        --vpc-id $VPC_ID `
        --cidr-block 10.0.1.0/24 `
        --availability-zone $az `
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$INSTANCE_NAME-subnet}]" `
        --query 'Subnet.SubnetId' `
        --output text
    $SUBNET_ID = $subnetResult

    aws ec2 modify-subnet-attribute --region $REGION --subnet-id $SUBNET_ID --map-public-ip-on-launch | Out-Null

    $igwResult = aws ec2 create-internet-gateway `
        --region $REGION `
        --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$INSTANCE_NAME-igw}]" `
        --query 'InternetGateway.InternetGatewayId' `
        --output text

    aws ec2 attach-internet-gateway --region $REGION --internet-gateway-id $igwResult --vpc-id $VPC_ID | Out-Null

    $rtbResult = aws ec2 create-route-table `
        --region $REGION `
        --vpc-id $VPC_ID `
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$INSTANCE_NAME-rtb}]" `
        --query 'RouteTable.RouteTableId' `
        --output text

    aws ec2 create-route --region $REGION --route-table-id $rtbResult --destination-cidr-block 0.0.0.0/0 --gateway-id $igwResult | Out-Null
    aws ec2 associate-route-table --region $REGION --subnet-id $SUBNET_ID --route-table-id $rtbResult | Out-Null

    Write-Success "Created subnet: $SUBNET_ID"
}

# ═══════════════════════════════════════════════════════════════════════════
# 5. Create Security Group
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 5 7 "Creating security group..."

$SG_NAME = "$INSTANCE_NAME-sg"

$sgJson = aws ec2 describe-security-groups `
    --region $REGION `
    --filters "Name=group-name,Values=$SG_NAME" `
              "Name=vpc-id,Values=$VPC_ID" `
    --query 'SecurityGroups[0].GroupId' `
    --output text 2>$null

if ($sgJson -and $sgJson -ne "None") {
    $SG_ID = $sgJson
    Write-Success "Using existing security group: $SG_ID"
} else {
    $sgResult = aws ec2 create-security-group `
        --region $REGION `
        --group-name $SG_NAME `
        --description "Security group for $INSTANCE_NAME" `
        --vpc-id $VPC_ID `
        --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_NAME}]" `
        --query 'GroupId' `
        --output text
    $SG_ID = $sgResult

    # Get public IP
    $MY_IP = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com" -TimeoutSec 10).Trim()
    Write-Info "Your public IP: $MY_IP"

    aws ec2 authorize-security-group-ingress `
        --region $REGION `
        --group-id $SG_ID `
        --protocol tcp --port 22 --cidr "$MY_IP/32" | Out-Null

    aws ec2 authorize-security-group-ingress `
        --region $REGION `
        --group-id $SG_ID `
        --protocol tcp --port 80 --cidr 0.0.0.0/0 | Out-Null

    aws ec2 authorize-security-group-ingress `
        --region $REGION `
        --group-id $SG_ID `
        --protocol tcp --port 443 --cidr 0.0.0.0/0 | Out-Null

    Write-Success "Created security group: $SG_ID"
    Write-Info "SSH (22) restricted to: $MY_IP/32"
    Write-Info "HTTP (80) open to: 0.0.0.0/0"
    Write-Info "HTTPS (443) open to: 0.0.0.0/0"
}

# ═══════════════════════════════════════════════════════════════════════════
# 6. Check / Create Key Pair
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 6 7 "Checking key pair..."

$keyJson = aws ec2 describe-key-pairs `
    --region $REGION `
    --key-names $KEY_NAME `
    --query 'KeyPairs[0].KeyName' `
    --output text 2>$null

if ($keyJson -and $keyJson -ne "None") {
    Write-Success "Key pair exists: $KEY_NAME"
    $keyPath = "$PWD\$KEY_NAME.pem"
    if (-not (Test-Path $keyPath)) {
        Write-Warn "$KEY_NAME.pem not found in current directory. Make sure you have the private key."
    }
} else {
    Write-Warn "Key pair '$KEY_NAME' not found. Creating new one..."
    Write-Host "  IMPORTANT: The .pem file will be saved to your current directory!" -ForegroundColor Red

    $keyMaterial = aws ec2 create-key-pair `
        --region $REGION `
        --key-name $KEY_NAME `
        --query 'KeyMaterial' `
        --output text

    $keyPath = "$PWD\$KEY_NAME.pem"
    $keyMaterial | Out-File -FilePath $keyPath -Encoding utf8
    Write-Success "Created and saved: $keyPath"
}

# ═══════════════════════════════════════════════════════════════════════════
# 7. Launch EC2 Instance
# ═══════════════════════════════════════════════════════════════════════════
Write-Step 7 7 "Launching EC2 instance..."

$instanceJson = aws ec2 run-instances `
    --region $REGION `
    --image-id $AMI_ID `
    --instance-type $INSTANCE_TYPE `
    --key-name $KEY_NAME `
    --security-group-ids $SG_ID `
    --subnet-id $SUBNET_ID `
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_SIZE,VolumeType=gp3,DeleteOnTermination=true}" `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" `
    --query 'Instances[0].InstanceId' `
    --output text

$INSTANCE_ID = $instanceJson
Write-Success "Instance launched: $INSTANCE_ID"

Write-Host "`nWaiting for instance to be running and have a public IP..." -ForegroundColor Yellow
aws ec2 wait instance-running --region $REGION --instance-ids $INSTANCE_ID

# Get instance details
$details = aws ec2 describe-instances `
    --region $REGION `
    --instance-ids $INSTANCE_ID `
    --query 'Reservations[0].Instances[0].[PublicIpAddress,PublicDnsName]' `
    --output json | ConvertFrom-Json

$PUBLIC_IP = $details[0]
$PUBLIC_DNS = $details[1]

# ═══════════════════════════════════════════════════════════════════════════
# OUTPUT
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  EC2 INSTANCE READY" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Instance ID:  $INSTANCE_ID" -ForegroundColor Cyan
Write-Host "  Public IP:    $PUBLIC_IP" -ForegroundColor Cyan
Write-Host "  Public DNS:   $PUBLIC_DNS" -ForegroundColor Cyan
Write-Host "  SSH Key:      $KEY_NAME.pem" -ForegroundColor Cyan
Write-Host ""
Write-Host "  SSH Command:" -ForegroundColor Yellow
Write-Host "  ssh -i $KEY_NAME.pem ubuntu@$PUBLIC_IP" -ForegroundColor White
Write-Host ""
Write-Host "  DNS Record to create:" -ForegroundColor Yellow
Write-Host "  A record: staging.fin.xtend.co -> $PUBLIC_IP" -ForegroundColor White
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green

# Save details
$detailsFile = "$PWD\instance-details.txt"
@"
XTEND FINANCIAL STATIC — Instance Details
Generated: $(Get-Date)

Instance ID: $INSTANCE_ID
Public IP:   $PUBLIC_IP
Public DNS:  $PUBLIC_DNS
Region:      $REGION
Key Pair:    $KEY_NAME.pem
VPC:         $VPC_ID
Subnet:      $SUBNET_ID
Security Group: $SG_ID

SSH Command:
  ssh -i $KEY_NAME.pem ubuntu@$PUBLIC_IP

DNS Record:
  A record: staging.fin.xtend.co -> $PUBLIC_IP

Next Steps:
  1. Add DNS A record for staging.fin.xtend.co
  2. SSH into instance
  3. Run: curl -fsSL https://raw.githubusercontent.com/Ash2428-1/xtend-financial-static/main/bootstrap-ec2.sh | bash
  4. Set up SSL: sudo certbot --nginx -d staging.fin.xtend.co
  5. Add GitHub Actions secrets for auto-deploy
"@ | Out-File -FilePath $detailsFile -Encoding utf8

Write-Host "Details saved to: $detailsFile" -ForegroundColor Cyan
Write-Host ""
