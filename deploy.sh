#!/bin/bash
# Deployment script for finance-manager
# Usage: ./deploy.sh [options]
#
# Options:
#   --full     Full deployment (git pull, build, restart services)
#   --frontend Only rebuild frontend (no git pull)
#   --backend  Only restart backend server
#   --status   Show service status
#
# Without options, performs a full deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_status() {
    echo "=== Finance Manager Status ==="
    echo ""
    echo "Git:"
    git rev-parse --abbrev-ref HEAD 2>/dev/null && git log -1 --oneline || echo "Not a git repo"
    echo ""
    echo "Backend server:"
    systemctl is-active finance-manager 2>/dev/null && log_info "Running" || log_error "Stopped"
    echo ""
    echo "Port 3847:"
    if lsof -i:3847 >/dev/null 2>&1; then
        log_info "In use"
    else
        log_warn "Not in use"
    fi
    echo ""
    echo "Recent service logs:"
    journalctl -u finance-manager -n 5 --no-pager 2>/dev/null || echo "No logs available"
}

setup_symlinks() {
    log_info "Setting up directories and symlinks..."

    # Create db directory
    if [ ! -d "db" ]; then
        mkdir -p db
        log_info "Created db/ directory"
    fi

    # Create backend/db symlink
    if [ ! -L "backend/db" ]; then
        ln -sf ../db backend/db
        log_info "Created backend/db symlink"
    fi

    # Create assets directory
    if [ ! -d "assets" ]; then
        mkdir -p assets
        log_info "Created assets/ directory"
    fi

    # Create backend/assets symlink
    if [ ! -L "backend/assets" ]; then
        ln -sf ../assets backend/assets
        log_info "Created backend/assets symlink"
    fi

    # Create server/ directory symlink for systemd service
    if [ ! -d "server" ]; then
        mkdir -p server
    fi
    if [ ! -L "server/index.js" ]; then
        ln -sf ../backend/index.js server/index.js
        log_info "Created server/index.js symlink"
    fi
}

pull_changes() {
    log_info "Pulling latest changes from Git..."
    git pull origin main
}

build_frontend() {
    log_info "Building frontend..."
    cd frontend
    node build.mjs
    cd ..

    # Copy docs if they exist
    if [ -d "docs" ]; then
        log_info "Copying documentation..."
        cp -r docs/* public/ 2>/dev/null || true
    fi

    log_info "Frontend built successfully"
}

deploy_backend() {
    log_info "Deploying backend..."

    # Reload systemd service
    systemctl reload finance-manager
    sleep 2

    if systemctl is-active --quiet finance-manager; then
        log_info "Backend server reloaded successfully"
    else
        log_error "Backend server failed to reload"
        log_info "Check logs with: journalctl -u finance-manager -n 50"
        exit 1
    fi
}

restart_backend() {
    log_info "Restarting backend server..."

    # Kill any processes on port 3847
    if lsof -i:3847 >/dev/null 2>&1; then
        log_info "Killing process on port 3847..."
        fuser -k 3847/tcp 2>/dev/null || true
        sleep 1
    fi

    # Restart systemd service
    systemctl restart finance-manager
    sleep 2

    if systemctl is-active --quiet finance-manager; then
        log_info "Backend server started successfully"
    else
        log_error "Backend server failed to start"
        log_info "Check logs with: journalctl -u finance-manager -n 50"
        exit 1
    fi
}

show_help() {
    echo "Finance Manager Deployment Script"
    echo ""
    echo "Usage: ./deploy.sh [options]"
    echo ""
    echo "Options:"
    echo "  --full     Full deployment (git pull, build, restart) [default]"
    echo "  --frontend Only rebuild frontend (no git pull)"
    echo "  --backend  Only restart backend server"
    echo "  --status   Show current status"
    echo "  --setup    Only setup symlinks (no deployment)"
    echo "  -h, --help Show this help"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh           # Full deployment"
    echo "  ./deploy.sh --status  # Check status"
    echo "  ./deploy.sh --backend # Restart server only"
}

# Parse arguments
ACTION="full"
while [[ $# -gt 0 ]]; do
    case $1 in
        --full)
            ACTION="full"
            shift
            ;;
        --frontend)
            ACTION="frontend"
            shift
            ;;
        --backend)
            ACTION="backend"
            shift
            ;;
        --status)
            ACTION="status"
            shift
            ;;
        --setup)
            ACTION="setup"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Execute action
case $ACTION in
    status)
        show_status
        ;;
    setup)
        setup_symlinks
        log_info "Setup complete"
        ;;
    frontend)
        setup_symlinks
        build_frontend
        log_info "Frontend rebuild complete"
        ;;
    backend)
        deploy_backend
        ;;
    full)
        setup_symlinks
        pull_changes
        build_frontend
        restart_backend
        log_info "Deployment complete!"
        log_info "Check the app at: http://localhost:3847"
        ;;
esac
