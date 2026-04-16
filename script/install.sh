#!/usr/bin/env sh
set -e

# ─── VertexAgent Installer ──────────────────────────────────────────────────
# Usage:  curl -fsSL https://raw.githubusercontent.com/backsapce/VertexAgent/main/script/install.sh | sh
# ─────────────────────────────────────────────────────────────────────────────

REPO="https://github.com/backsapce/VertexAgent.git"
INSTALL_DIR="${VERTEX_AGENT_DIR:-$HOME/.vertex-agent}"
REQUIRED_NODE_MAJOR=18

# ─── Helpers ─────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$1"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$1"; }
error() { printf '\033[1;31m[error]\033[0m %s\n' "$1"; exit 1; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$1"; }

# ─── Detect OS & arch ───────────────────────────────────────────────────────

detect_os() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux*)  OS=linux  ;;
    Darwin*) OS=macos  ;;
    *)       error "Unsupported OS: $OS. Only Linux and macOS are supported." ;;
  esac
  case "$ARCH" in
    x86_64|amd64)  ARCH=x64   ;;
    arm64|aarch64) ARCH=arm64 ;;
    *)             warn "Unknown architecture: $ARCH — proceeding anyway." ;;
  esac
  info "Detected OS=$OS ARCH=$ARCH"
}

# ─── Check / install dependencies ───────────────────────────────────────────

has_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_git() {
  if has_cmd git; then
    info "git found: $(git --version)"
    return
  fi
  info "git not found — attempting to install..."
  if [ "$OS" = "linux" ]; then
    if has_cmd apt-get; then
      sudo apt-get update -qq && sudo apt-get install -y -qq git
    elif has_cmd dnf; then
      sudo dnf install -y git
    elif has_cmd yum; then
      sudo yum install -y git
    elif has_cmd pacman; then
      sudo pacman -Sy --noconfirm git
    elif has_cmd apk; then
      sudo apk add --no-cache git
    else
      error "Cannot install git automatically. Please install git manually and re-run."
    fi
  elif [ "$OS" = "macos" ]; then
    # Xcode CLT ships git; trigger install if missing
    xcode-select --install 2>/dev/null || true
    error "Please install Xcode Command Line Tools (git) and re-run this script."
  fi
  has_cmd git || error "git installation failed."
  ok "git installed"
}

check_node_version() {
  if ! has_cmd node; then
    return 1
  fi
  NODE_VERSION="$(node -v | sed 's/^v//')"
  NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
    return 0
  fi
  return 1
}

ensure_node() {
  if check_node_version; then
    info "Node.js found: $(node -v)"
    return
  fi

  info "Node.js >= $REQUIRED_NODE_MAJOR not found — installing via NodeSource..."

  if [ "$OS" = "linux" ]; then
    if has_cmd apt-get; then
      # NodeSource setup script
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y -qq nodejs
    elif has_cmd dnf; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -E bash -
      sudo dnf install -y nodejs
    elif has_cmd yum; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -E bash -
      sudo yum install -y nodejs
    elif has_cmd apk; then
      sudo apk add --no-cache nodejs npm
    elif has_cmd pacman; then
      sudo pacman -Sy --noconfirm nodejs npm
    else
      error "Cannot install Node.js automatically. Please install Node.js >= $REQUIRED_NODE_MAJOR and re-run."
    fi
  elif [ "$OS" = "macos" ]; then
    if has_cmd brew; then
      brew install node
    else
      info "Homebrew not found — installing Node.js via official installer..."
      if [ "$ARCH" = "arm64" ]; then
        NODE_PKG_URL="https://nodejs.org/dist/latest-v22.x/node-v22.0.0-darwin-arm64.tar.gz"
      else
        NODE_PKG_URL="https://nodejs.org/dist/latest-v22.x/node-v22.0.0-darwin-x64.tar.gz"
      fi
      # Fallback: recommend Homebrew
      warn "Auto-install without Homebrew is unreliable."
      error "Please install Homebrew (https://brew.sh) or Node.js (https://nodejs.org) and re-run."
    fi
  fi

  check_node_version || error "Node.js installation failed or version too old."
  ok "Node.js installed: $(node -v)"
}

# ─── Clone / update repository ──────────────────────────────────────────────

clone_or_update() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing installation found at $INSTALL_DIR — pulling latest..."
    cd "$INSTALL_DIR"
    git pull --ff-only || warn "git pull failed — continuing with existing code."
  else
    info "Cloning VertexAgent into $INSTALL_DIR..."
    git clone --depth 1 "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
  ok "Source ready at $INSTALL_DIR"
}

# ─── Install deps & build ───────────────────────────────────────────────────

install_and_build() {
  cd "$INSTALL_DIR"
  info "Installing npm dependencies..."
  npm ci --loglevel=error
  info "Building frontend..."
  npm run build
  ok "Build complete"
}

# ─── Create launcher script ─────────────────────────────────────────────────

create_launcher() {
  LAUNCHER="$INSTALL_DIR/vertex-agent"
  cat > "$LAUNCHER" <<'SCRIPT'
#!/usr/bin/env sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export AGENT_PORT="${AGENT_PORT:-3099}"
exec node "$SCRIPT_DIR/server/agent.js" "$@"
SCRIPT
  chmod +x "$LAUNCHER"

  # Symlink into PATH
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  ln -sf "$LAUNCHER" "$BIN_DIR/vertex-agent"

  ok "Launcher created at $LAUNCHER"

  # Check if BIN_DIR is in PATH
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not in your PATH."
      info "Add this to your shell profile:"
      info "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac
}

# ─── Summary ─────────────────────────────────────────────────────────────────

print_summary() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║           VertexAgent installed successfully!           ║"
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "║                                                        ║"
  echo "║  Start the server:                                     ║"
  echo "║    vertex-agent                                        ║"
  echo "║                                                        ║"
  echo "║  Or run directly:                                      ║"
  echo "║    cd $INSTALL_DIR"
  echo "║    node server/agent.js                                ║"
  echo "║                                                        ║"
  echo "║  Default port: 3099  (override with AGENT_PORT=XXXX)  ║"
  echo "║  Open http://localhost:3099 in your browser            ║"
  echo "║                                                        ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  echo ""
  info "Starting VertexAgent installer..."
  echo ""
  detect_os
  ensure_git
  ensure_node
  clone_or_update
  install_and_build
  create_launcher
  print_summary
}

main
