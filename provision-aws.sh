#!/bin/bash
# ============================================================================
# AWS Infrastructure Provisioning Script
# Region: af-south-1 | Project: xtend-financial-static
# ============================================================================
set -e

REGION="af-south-1"
INSTANCE_NAME="xtend-financial-static"
INSTANCE_TYPE="t3.micro"
AMI_NAME="ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
KEY_NAME="guud-fleet-staging-key"
VOLUME_SIZE=20

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== XTEND FINANCIAL — AWS PROVISIONING ===${NC}"
echo -e "${BLUE}Region: $REGION${NC}"
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 1. Verify AWS CLI & SSO login
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 1/7: Checking AWS CLI authentication...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI is not installed.${NC}"
    echo "Install it first: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
    exit 1
fi

# Check if we're authenticated
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}ERROR: Not authenticated with AWS.${NC}"
    echo ""
    echo "Run the SSO login command:"
    echo "  aws sso login --profile PowerUserAccess-491598972312"
    echo ""
    echo "Or if you haven't configured SSO yet:"
    echo "  aws configure sso"
    echo "  SSO start URL: https://d-90671c5d83.awsapps.com/start"
    echo "  SSO region:     eu-west-1"
    echo "  Account ID:     491598972312"
    echo "  Role name:      PowerUserAccess"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ Authenticated (Account: $ACCOUNT_ID)${NC}"
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 2. Find Ubuntu 22.04 AMI
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 2/7: Finding Ubuntu 22.04 AMI...${NC}"
AMI_ID=$(aws ec2 describe-images \
    --region $REGION \
    --owners 099720109477 \
    --filters "Name=name,Values=$AMI_NAME" \
              "Name=virtualization-type,Values=hvm" \
              "Name=architecture,Values=x86_64" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text)

if [ "$AMI_ID" == "None" ] || [ -z "$AMI_ID" ]; then
    echo -e "${RED}ERROR: Could not find Ubuntu 22.04 AMI in $REGION${NC}"
    exit 1
fi

echo -e "${GREEN}✓ AMI found: $AMI_ID${NC}"
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 3. Get or create VPC
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 3/7: Finding VPC...${NC}"

# Try to find existing GUUD Fleet VPC first
VPC_ID=$(aws ec2 describe-vpcs \
    --region $REGION \
    --filters "Name=tag:Name,Values=guud-fleet-staging-vpc" \
    --query 'Vpcs[0].VpcId' \
    --output text 2>/dev/null || echo "None")

if [ "$VPC_ID" == "None" ] || [ -z "$VPC_ID" ]; then
    # Fall back to default VPC
    VPC_ID=$(aws ec2 describe-vpcs \
        --region $REGION \
        --filters "Name=isDefault,Values=true" \
        --query 'Vpcs[0].VpcId' \
        --output text)
    
    if [ "$VPC_ID" == "None" ] || [ -z "$VPC_ID" ]; then
        echo -e "${YELLOW}! No default VPC found. Creating new VPC...${NC}"
        VPC_ID=$(aws ec2 create-vpc \
            --region $REGION \
            --cidr-block 10.0.0.0/16 \
            --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$INSTANCE_NAME-vpc}]" \
            --query 'Vpc.VpcId' \
            --output text)
        
        aws ec2 modify-vpc-attribute \
            --region $REGION \
            --vpc-id $VPC_ID \
            --enable-dns-hostnames
        
        echo -e "${GREEN}✓ Created VPC: $VPC_ID${NC}"
    else
        echo -e "${GREEN}✓ Using default VPC: $VPC_ID${NC}"
    fi
else
    echo -e "${GREEN}✓ Using existing GUUD Fleet VPC: $VPC_ID${NC}"
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 4. Get or create Subnet
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 4/7: Finding public subnet...${NC}"

SUBNET_ID=$(aws ec2 describe-subnets \
    --region $REGION \
    --filters "Name=vpc-id,Values=$VPC_ID" \
              "Name=map-public-ip-on-launch,Values=true" \
    --query 'Subnets[0].SubnetId' \
    --output text)

if [ "$SUBNET_ID" == "None" ] || [ -z "$SUBNET_ID" ]; then
    echo -e "${YELLOW}! No public subnet found. Creating one...${NC}"
    
    # Get availability zones
    AZ=$(aws ec2 describe-availability-zones \
        --region $REGION \
        --query 'AvailabilityZones[0].ZoneName' \
        --output text)
    
    SUBNET_ID=$(aws ec2 create-subnet \
        --region $REGION \
        --vpc-id $VPC_ID \
        --cidr-block 10.0.1.0/24 \
        --availability-zone $AZ \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$INSTANCE_NAME-subnet}]" \
        --query 'Subnet.SubnetId' \
        --output text)
    
    aws ec2 modify-subnet-attribute \
        --region $REGION \
        --subnet-id $SUBNET_ID \
        --map-public-ip-on-launch
    
    # Create and attach internet gateway if needed
    IGW_ID=$(aws ec2 create-internet-gateway \
        --region $REGION \
        --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$INSTANCE_NAME-igw}]" \
        --query 'InternetGateway.InternetGatewayId' \
        --output text)
    
    aws ec2 attach-internet-gateway \
        --region $REGION \
        --internet-gateway-id $IGW_ID \
        --vpc-id $VPC_ID
    
    # Create route table
    RTB_ID=$(aws ec2 create-route-table \
        --region $REGION \
        --vpc-id $VPC_ID \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$INSTANCE_NAME-rtb}]" \
        --query 'RouteTable.RouteTableId' \
        --output text)
    
    aws ec2 create-route \
        --region $REGION \
        --route-table-id $RTB_ID \
        --destination-cidr-block 0.0.0.0/0 \
        --gateway-id $IGW_ID
    
    aws ec2 associate-route-table \
        --region $REGION \
        --subnet-id $SUBNET_ID \
        --route-table-id $RTB_ID
    
    echo -e "${GREEN}✓ Created subnet: $SUBNET_ID${NC}"
else
    echo -e "${GREEN}✓ Using subnet: $SUBNET_ID${NC}"
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 5. Create Security Group
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 5/7: Creating security group...${NC}"

SG_NAME="$INSTANCE_NAME-sg"

# Check if security group already exists
SG_ID=$(aws ec2 describe-security-groups \
    --region $REGION \
    --filters "Name=group-name,Values=$SG_NAME" \
              "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "None")

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
    SG_ID=$(aws ec2 create-security-group \
        --region $REGION \
        --group-name $SG_NAME \
        --description "Security group for $INSTANCE_NAME" \
        --vpc-id $VPC_ID \
        --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_NAME}]" \
        --query 'GroupId' \
        --output text)
    
    # Get your public IP for SSH restriction
    MY_IP=$(curl -s https://checkip.amazonaws.com)
    echo -e "${BLUE}Your public IP: $MY_IP${NC}"
    
    # Add inbound rules
    aws ec2 authorize-security-group-ingress \
        --region $REGION \
        --group-id $SG_ID \
        --protocol tcp \
        --port 22 \
        --cidr "$MY_IP/32" \
        --tag-specifications "ResourceType=security-group-rule,Tags=[{Key=Name,Value=ssh-rule}]"
    
    aws ec2 authorize-security-group-ingress \
        --region $REGION \
        --group-id $SG_ID \
        --protocol tcp \
        --port 80 \
        --cidr 0.0.0.0/0
    
    aws ec2 authorize-security-group-ingress \
        --region $REGION \
        --group-id $SG_ID \
        --protocol tcp \
        --port 443 \
        --cidr 0.0.0.0/0
    
    echo -e "${GREEN}✓ Created security group: $SG_ID${NC}"
    echo -e "${GREEN}  SSH (22) restricted to: $MY_IP/32${NC}"
    echo -e "${GREEN}  HTTP (80) open to: 0.0.0.0/0${NC}"
    echo -e "${GREEN}  HTTPS (443) open to: 0.0.0.0/0${NC}"
else
    echo -e "${GREEN}✓ Using existing security group: $SG_ID${NC}"
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 6. Check / Create Key Pair
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 6/7: Checking key pair...${NC}"

KEY_EXISTS=$(aws ec2 describe-key-pairs \
    --region $REGION \
    --key-names $KEY_NAME \
    --query 'KeyPairs[0].KeyName' \
    --output text 2>/dev/null || echo "None")

if [ "$KEY_EXISTS" == "None" ] || [ -z "$KEY_EXISTS" ]; then
    echo -e "${YELLOW}! Key pair '$KEY_NAME' not found. Creating new one...${NC}"
    echo -e "${RED}IMPORTANT: The .pem file will be downloaded to your current directory.${NC}"
    echo -e "${RED}Save it securely — you cannot download it again!${NC}"
    
    aws ec2 create-key-pair \
        --region $REGION \
        --key-name $KEY_NAME \
        --query 'KeyMaterial' \
        --output text > "$KEY_NAME.pem"
    
    chmod 400 "$KEY_NAME.pem"
    echo -e "${GREEN}✓ Created and saved: $KEY_NAME.pem${NC}"
else
    echo -e "${GREEN}✓ Key pair exists: $KEY_NAME${NC}"
    if [ ! -f "$KEY_NAME.pem" ]; then
        echo -e "${YELLOW}WARNING: $KEY_NAME.pem not found in current directory.${NC}"
        echo "Make sure you have the private key file for SSH access."
    fi
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 7. Launch EC2 Instance
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 7/7: Launching EC2 instance...${NC}"

INSTANCE_ID=$(aws ec2 run-instances \
    --region $REGION \
    --image-id $AMI_ID \
    --instance-type $INSTANCE_TYPE \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --subnet-id $SUBNET_ID \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_SIZE,VolumeType=gp3,DeleteOnTermination=true}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --query 'Instances[0].InstanceId' \
    --output text)

echo -e "${GREEN}✓ Instance launched: $INSTANCE_ID${NC}"
echo ""
echo -e "${YELLOW}Waiting for instance to be running and have a public IP...${NC}"

aws ec2 wait instance-running --region $REGION --instance-ids $INSTANCE_ID

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --region $REGION \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

PUBLIC_DNS=$(aws ec2 describe-instances \
    --region $REGION \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicDnsName' \
    --output text)

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  EC2 INSTANCE READY${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Instance ID:${NC}  $INSTANCE_ID"
echo -e "  ${BLUE}Public IP:${NC}    $PUBLIC_IP"
echo -e "  ${BLUE}Public DNS:${NC}   $PUBLIC_DNS"
echo -e "  ${BLUE}SSH Key:${NC}      $KEY_NAME.pem"
echo ""
echo -e "  ${YELLOW}SSH Command:${NC}"
echo -e "  ssh -i $KEY_NAME.pem ubuntu@$PUBLIC_IP"
echo ""
echo -e "  ${YELLOW}DNS Record to create:${NC}"
echo -e "  A record: staging.fin.xtend.co → $PUBLIC_IP"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""

# Save details to file for later reference
cat > "instance-details.txt" <<EOF
XTEND FINANCIAL STATIC — Instance Details
Generated: $(date)

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
  A record: staging.fin.xtend.co → $PUBLIC_IP

Next Steps:
  1. Add DNS A record
  2. SSH into instance
  3. Run: curl -fsSL https://raw.githubusercontent.com/Ash2428-1/xtend-financial-static/main/bootstrap-ec2.sh | bash
  4. Set up SSL: sudo certbot --nginx -d staging.fin.xtend.co
  5. Add GitHub Actions secrets for auto-deploy
EOF

echo -e "${BLUE}Details saved to: instance-details.txt${NC}"
echo ""
