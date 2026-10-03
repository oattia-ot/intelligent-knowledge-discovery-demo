# Git Commands — Expert Guide for Updating the GitHub Repo

> **Repository:** `https://github.com/oattia-ot/intelligent-knowledge-discovery-demo.git`  
> **Maintainer:** `oattia-ot` (`oren.attiaa@gmail.com`)

This document provides a clean, production-ready set of Git commands for managing the **Intelligent Knowledge Discovery Demo** repository.  
It covers one-time setup, daily workflow, authentication fixes, and common troubleshooting — especially the frequent VS Code credential socket error.

---

## 1. One-Time Repository Setup

Run these commands **only once** when initializing the repository for the first time.

```bash
# Set version (update this value as needed)
export VERSION="ver-1.6r0m1"

# Write a clean version file
cat > version.txt << EOF
Intelligent Knowledge Discovery Demo
=============================
Version: ${VERSION:-unknown}
Pushed to GitHub: $(date '+%Y-%m-%d %H:%M:%S %Z')
EOF

# Initialize and connect to remote (only needed once)
git init
git remote add origin https://github.com/oattia-ot/intelligent-knowledge-discovery-demo.git
git branch -M main

# Stage, commit and push
git add .
git commit -m "${VERSION}"
git push -u origin main          # preferred: sets upstream tracking
# git push -f origin main        # only when you intentionally want to overwrite remote history
```

> **Warning:** Force push (`-f`) rewrites remote history. Use it only when you are sure no one else is working on the branch.

---

## 2. Recommended Global Git Configuration

```bash
git config --global user.email "oren.attiaa@gmail.com"
git config --global user.name  "oattia-ot"

# Performance & reliability on slow / unstable connections
git config --global http.postBuffer 524288000
git config --global http.version HTTP/1.1
git config --global core.compression 0
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
```

---

## 3. Authentication Setup

### Create a Personal Access Token (if you don’t have one)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it at least the **`repo`** scope
4. Copy the token and use it as the **password** when Git asks for credentials  
   (Username = `oattia-ot`)

### Better long-term solution: Switch to SSH

```bash
# Change remote from HTTPS to SSH
git remote set-url origin git@github.com:oattia-ot/intelligent-knowledge-discovery-demo.git

# Verify
git remote -v
```

Then make sure you have an SSH key added to GitHub:

```bash
# Check if you already have a key
ls -la ~/.ssh/id_*.pub

# If not, generate one
ssh-keygen -t ed25519 -C "oren.attiaa@gmail.com"

# Start ssh-agent and add the key
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# Copy the public key
cat ~/.ssh/id_ed25519.pub
```

Add that public key to **GitHub → Settings → SSH and GPG keys**.

Then push again:

```bash
git push -f origin main
```

> After switching to SSH you will no longer need tokens or have to fight VS Code credential helpers.

---

## 4. Fixing Authentication Failures (VS Code Socket Error)

### The Error You Encountered

```
git push -f origin main
Missing or invalid credentials.
Error: connect ECONNREFUSED /run/user/1000/vscode-git-594aa28b44.sock
...
remote: No anonymous write access.
fatal: Authentication failed for 'https://github.com/oattia-ot/intelligent-knowledge-discovery-demo.git/'
```

### Why This Happens

VS Code injects its own Git credential helper via environment variables (`GIT_ASKPASS`, `VSCODE_GIT_ASKPASS_*`).  
When the VS Code process that owns the socket is not running (or the terminal is outside the integrated terminal), Git cannot reach the socket → `ECONNREFUSED` → authentication fails.

### Solution A — Quick Bypass (Recommended when the error appears)

Clear the VS Code-injected environment variables for a single push:

```bash
env -u GIT_ASKPASS -u VSCODE_GIT_ASKPASS_NODE -u VSCODE_GIT_ASKPASS_MAIN -u VSCODE_GIT_IPC_HANDLE \
  git push -f origin main
```

### Solution B — Permanently Remove Broken Credential Helper

```bash
git config --global --unset credential.helper
git config --global --unset-all credential.helper
```

Then push again. Git will prompt for credentials.

- **Username:** `oattia-ot`
- **Password:** a **GitHub Personal Access Token** (not your account password)

### Solution C — Switch to SSH (Best Long-Term Fix)

See the detailed steps in **Section 3** above.

### Solution D — Use GitHub CLI (Cleanest)

```bash
gh auth login
```

Follow the interactive prompts (HTTPS or SSH). After authentication, all Git commands work seamlessly.

---

## 5. Daily Workflow

```bash
git status                            # see what changed
git add .                             # stage everything
# or
git add <specific-file>               # stage only one file

git commit -m "your descriptive message"
git push origin main
```

---

## 6. Always Pull Before Pushing (Avoid Conflicts)

```bash
# Option 1 – merge (default)
git pull origin main

# Option 2 – rebase (cleaner history – preferred)
git pull --rebase origin main
```

---

## 7. Inspect Repository State

```bash
git branch                            # list local branches
git remote -v                         # show remote URLs
git log --oneline -5                  # last 5 commits
git diff                              # unstaged changes
git status -sb                        # short status
```

---

## 8. Fix Common Problems

```bash
# Rename local branch from master → main
git branch -m master main
git push -u origin main

# Remote has commits you don’t have yet
git fetch origin
git rebase origin/main
git push origin main

# Undo last commit but keep the changes
git reset --soft HEAD~1

# Undo last commit and discard the changes (dangerous)
git reset --hard HEAD~1
```

---

## 9. Safe Full Update Cycle (Recommended Daily Routine)

```bash
git pull --rebase origin main         # sync with remote first
git add .
git commit -m "your message"
git push origin main
```

---

## 10. Useful Diagnostics

### Top 20 largest files (recursive)

```bash
du -ah --max-depth=100 | sort -hr | head -n 20
```

**Pro Tips**

- Prefer SSH over HTTPS for daily work — it avoids token and VS Code socket issues entirely.
- Never force-push to `main` unless you fully understand the consequences.
- Keep `version.txt` updated before every important push.
- When working inside VS Code Remote / WSL / containers, always prefer the integrated terminal or use the `env -u ...` bypass shown above.
