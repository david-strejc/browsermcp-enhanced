#!/bin/bash

# Create new Supabase project on self-hosted infrastructure
# Usage: ./create-supabase-project.sh project-name port-offset

PROJECT_NAME=${1:-project2}
PORT_OFFSET=${2:-1}

# Base ports
BASE_STUDIO_PORT=3000
BASE_KONG_PORT=8000
BASE_POSTGRES_PORT=5432

# Calculate new ports
STUDIO_PORT=$((BASE_STUDIO_PORT + PORT_OFFSET))
KONG_PORT=$((BASE_KONG_PORT + PORT_OFFSET))
POSTGRES_PORT=$((BASE_POSTGRES_PORT + PORT_OFFSET))

echo "🚀 Creating new Supabase project: $PROJECT_NAME"
echo "   Studio Port: $STUDIO_PORT"
echo "   API Port: $KONG_PORT"
echo "   DB Port: $POSTGRES_PORT"

# Create project directory
PROJECT_DIR="/opt/supabase-$PROJECT_NAME"
sudo mkdir -p $PROJECT_DIR

# Clone Supabase docker setup
cd /tmp
git clone https://github.com/supabase/supabase supabase-temp
sudo cp -r supabase-temp/docker/* $PROJECT_DIR/
rm -rf supabase-temp

cd $PROJECT_DIR

# Generate secure passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
ANON_KEY=$(openssl rand -base64 32)
SERVICE_KEY=$(openssl rand -base64 32)

# Create .env file
sudo tee .env > /dev/null <<EOF
############
# Secrets
############
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_KEY

############
# Ports
############
STUDIO_PORT=$STUDIO_PORT
KONG_HTTP_PORT=$KONG_PORT
KONG_HTTPS_PORT=$((KONG_PORT + 443))
POSTGRES_PORT=$POSTGRES_PORT

############
# Database
############
POSTGRES_DB=$PROJECT_NAME

############
# API Config
############
SITE_URL=https://$PROJECT_NAME.apertia.ai
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false

############
# Studio Config
############
STUDIO_DEFAULT_ORGANIZATION=$PROJECT_NAME
STUDIO_DEFAULT_PROJECT=$PROJECT_NAME
EOF

echo "📝 Configuration created at $PROJECT_DIR/.env"

# Start the project
echo "🐳 Starting Docker containers..."
sudo docker compose -p supabase-$PROJECT_NAME up -d

echo "✅ Project $PROJECT_NAME created!"
echo ""
echo "📌 Access Points:"
echo "   Studio: http://localhost:$STUDIO_PORT"
echo "   API: http://localhost:$KONG_PORT"
echo "   Database: localhost:$POSTGRES_PORT"
echo ""
echo "🔑 Credentials saved in: $PROJECT_DIR/.env"
echo ""
echo "📦 Manage with:"
echo "   cd $PROJECT_DIR"
echo "   docker compose -p supabase-$PROJECT_NAME [stop|start|logs|down]"