# ============================================================================
# AWS Cognito Setup for xtend-financial-static
# Run this in PowerShell to create the User Pool and users
# ============================================================================

$REGION = "af-south-1"
$POOL_NAME = "xtend-financial-users"

Write-Host "=== Creating Cognito User Pool ===" -ForegroundColor Cyan

# Create user pool with custom role attribute
$poolJson = aws cognito-idp create-user-pool `
    --region $REGION `
    --pool-name $POOL_NAME `
    --policies 'PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}' `
    --schema 'Name=role,AttributeDataType=String,Mutable=true,Required=false' `
    --auto-verified-attributes email `
    --output json | ConvertFrom-Json

$USER_POOL_ID = $poolJson.UserPool.Id
Write-Host "User Pool ID: $USER_POOL_ID" -ForegroundColor Green

# Create app client (no secret, for JavaScript SPA)
$clientJson = aws cognito-idp create-user-pool-client `
    --region $REGION `
    --user-pool-id $USER_POOL_ID `
    --client-name xtend-web-client `
    --no-generate-secret `
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH `
    --output json | ConvertFrom-Json

$CLIENT_ID = $clientJson.UserPoolClient.ClientId
Write-Host "Client ID: $CLIENT_ID" -ForegroundColor Green

# Create super admin users
Write-Host "`n=== Creating users ===" -ForegroundColor Cyan

$users = @(
    @{ Email = "ashley@guud.global"; Password = "Mobi2027@!"; Role = "superadmin" },
    @{ Email = "gareth@guud.global"; Password = "Mobi2027@!"; Role = "superadmin" }
)

foreach ($user in $users) {
    Write-Host "Creating user: $($user.Email)" -ForegroundColor Yellow

    aws cognito-idp admin-create-user `
        --region $REGION `
        --user-pool-id $USER_POOL_ID `
        --username $user.Email `
        --user-attributes "Name=email,Value=$($user.Email)" "Name=custom:role,Value=$($user.Role)" `
        --message-action SUPPRESS `
        --output json | Out-Null

    aws cognito-idp admin-set-user-password `
        --region $REGION `
        --user-pool-id $USER_POOL_ID `
        --username $user.Email `
        --password $user.Password `
        --permanent

    Write-Host "  Created: $($user.Email) [role=$($user.Role)]" -ForegroundColor Green
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  COGNITO SETUP COMPLETE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  User Pool ID: $USER_POOL_ID" -ForegroundColor Cyan
Write-Host "  Client ID:    $CLIENT_ID" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Add these to your auth.js file:" -ForegroundColor Yellow
Write-Host "  const USER_POOL_ID = '$USER_POOL_ID';" -ForegroundColor White
Write-Host "  const CLIENT_ID = '$CLIENT_ID';" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

# Save details
@"
COGNITO CONFIGURATION
Generated: $(Get-Date)

User Pool ID: $USER_POOL_ID
Client ID:    $CLIENT_ID
Region:       $REGION

Users:
  ashley@guud.global  [superadmin]
  gareth@guud.global  [superadmin]

Add to auth.js:
  const USER_POOL_ID = '$USER_POOL_ID';
  const CLIENT_ID = '$CLIENT_ID';
"@ | Out-File -FilePath "$PWD\cognito-config.txt" -Encoding utf8

Write-Host "`nDetails saved to: cognito-config.txt" -ForegroundColor Cyan
