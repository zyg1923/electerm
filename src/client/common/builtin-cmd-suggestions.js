/**
 * Built-in terminal command catalog and path-completion helpers.
 */

export const PATH_CMDS = new Set([
  'cd', 'ls', 'll', 'la', 'dir',
  'cat', 'less', 'more', 'head', 'tail', 'type',
  'vim', 'vi', 'nano', 'code', 'open', 'start', 'explorer',
  'rm', 'rmdir', 'del', 'rd',
  'cp', 'mv', 'copy', 'move',
  'mkdir', 'md', 'touch',
  'chmod', 'chown', 'stat', 'file',
  'unzip', 'tar', 'source', 'bash', 'sh'
])

export const BUILTIN_COMMANDS = [
  // navigation / files
  'cd', 'cd ..', 'cd ~', 'cd -', 'cd /',
  'ls', 'ls -la', 'ls -lh', 'ls -alF', 'll', 'la', 'pwd', 'tree',
  'mkdir', 'mkdir -p', 'rmdir', 'rm', 'rm -rf', 'cp', 'cp -r', 'mv', 'touch',
  'cat', 'less', 'more', 'head', 'tail', 'tail -f',
  'find', 'find . -name', 'grep', 'grep -rn', 'rg', 'awk', 'sed',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'xargs',
  'chmod', 'chmod +x', 'chown', 'ln -s',
  'du -sh', 'du -h', 'df -h', 'stat', 'file',
  'which', 'whereis', 'type', 'basename', 'dirname', 'realpath',
  'pushd', 'popd',

  // process
  'ps', 'ps aux', 'ps -ef', 'top', 'htop',
  'kill', 'kill -9', 'killall', 'pkill', 'pgrep',
  'jobs', 'bg', 'fg', 'nohup', 'nice', 'watch',
  'lsof', 'lsof -i',

  // network
  'ping', 'curl', 'curl -I', 'curl -L', 'wget',
  'ssh', 'scp', 'sftp', 'rsync', 'rsync -avz',
  'netstat -tulnp', 'netstat -ano', 'ss -tulnp',
  'ip a', 'ip r', 'ifconfig', 'traceroute', 'tracepath',
  'nslookup', 'dig', 'host', 'telnet', 'nc', 'nmap',

  // system
  'uname -a', 'hostname', 'whoami', 'id', 'date', 'uptime',
  'free -h', 'lscpu', 'lsblk', 'mount', 'umount',
  'systemctl status', 'systemctl start', 'systemctl stop',
  'systemctl restart', 'systemctl enable', 'systemctl disable',
  'journalctl -u', 'journalctl -f', 'dmesg',
  'env', 'export', 'echo', 'history', 'clear', 'alias',
  'sudo', 'su', 'reboot', 'shutdown -h now',
  'cat /etc/os-release',

  // git
  'git status', 'git add .', 'git add -A', 'git add -p',
  'git commit -m ""', 'git commit --amend',
  'git push', 'git push -u origin HEAD', 'git pull', 'git pull --rebase',
  'git fetch', 'git fetch --all', 'git clone',
  'git checkout', 'git checkout -b', 'git switch', 'git switch -c',
  'git branch', 'git branch -a', 'git branch -d',
  'git log', 'git log --oneline', 'git log --graph --oneline --all',
  'git diff', 'git diff --staged',
  'git stash', 'git stash pop', 'git stash list',
  'git merge', 'git rebase', 'git rebase -i',
  'git remote -v', 'git reset', 'git reset --hard HEAD',
  'git revert', 'git tag', 'git show', 'git cherry-pick',
  'git blame', 'git config --list', 'git init',

  // docker
  'docker ps', 'docker ps -a', 'docker images',
  'docker pull', 'docker push',
  'docker run', 'docker run -it --rm', 'docker run -d --name',
  'docker exec -it', 'docker logs', 'docker logs -f',
  'docker stop', 'docker start', 'docker restart',
  'docker rm', 'docker rmi', 'docker build -t',
  'docker inspect', 'docker stats',
  'docker network ls', 'docker volume ls',
  'docker system prune', 'docker login',
  'docker compose up', 'docker compose up -d', 'docker compose down',
  'docker compose ps', 'docker compose logs', 'docker compose logs -f',
  'docker compose build', 'docker compose restart', 'docker compose pull',
  'docker-compose up -d', 'docker-compose down', 'docker-compose ps',

  // kubernetes
  'kubectl get pods', 'kubectl get pods -A', 'kubectl get pods -o wide',
  'kubectl get nodes', 'kubectl get svc', 'kubectl get deploy',
  'kubectl get ns', 'kubectl get ingress',
  'kubectl describe pod', 'kubectl describe node',
  'kubectl logs', 'kubectl logs -f',
  'kubectl exec -it', 'kubectl apply -f', 'kubectl delete -f',
  'kubectl config get-contexts', 'kubectl config use-context',
  'kubectl top pods', 'kubectl top nodes',

  // node / js
  'npm install', 'npm ci', 'npm run', 'npm start', 'npm test',
  'npm run build', 'npm run dev', 'npm init -y', 'npm publish',
  'npx', 'node', 'node -v', 'npm -v',
  'yarn', 'yarn install', 'yarn add', 'yarn dev',
  'pnpm', 'pnpm install', 'pnpm dev',

  // python
  'python', 'python3', 'python3 -m venv .venv',
  'pip install', 'pip3 install', 'pip freeze', 'pip list',
  'pip install -r requirements.txt',

  // editors / archive
  'vim', 'vi', 'nano', 'code', 'code .',
  'tar -czvf', 'tar -xzvf', 'tar -tzvf',
  'zip', 'unzip', 'gzip', 'gunzip',

  // packages
  'apt update', 'apt upgrade', 'apt install', 'apt search',
  'yum install', 'dnf install', 'pacman -S',
  'brew install', 'brew update', 'brew upgrade',

  // db / infra
  'mysql -u root -p', 'redis-cli', 'mongo', 'psql', 'sqlite3',
  'make', 'make install', 'cmake',
  'terraform init', 'terraform plan', 'terraform apply',
  'ansible-playbook',
  'tmux', 'tmux ls', 'tmux attach', 'screen',
  'ssh-keygen', 'ssh-copy-id', 'ssh-add',
  'crontab -l', 'crontab -e',

  // windows
  'dir', 'cls', 'copy', 'move', 'del', 'rd', 'md',
  'ipconfig', 'ipconfig /all',
  'tasklist', 'taskkill /PID', 'where', 'start',
  'powershell', 'Get-Process', 'Get-Service',
  'systeminfo', 'choco install', 'scoop install', 'winget install'
]

const MAX_PATH_ITEMS = 30

export function parsePathCommand (cmd = '') {
  const withArg = cmd.match(/^([A-Za-z.]+)(\s+)(.*)$/)
  if (withArg) {
    const bin = withArg[1]
    if (!PATH_CMDS.has(bin)) {
      return null
    }
    return {
      bin,
      arg: withArg[3],
      prefix: bin + withArg[2],
      dirsOnly: bin === 'cd' || bin === 'rd' || bin === 'rmdir' || bin === 'md' || bin === 'mkdir'
    }
  }
  if (PATH_CMDS.has(cmd)) {
    return {
      bin: cmd,
      arg: '',
      prefix: cmd + ' ',
      dirsOnly: cmd === 'cd' || cmd === 'rd' || cmd === 'rmdir' || cmd === 'md' || cmd === 'mkdir',
      needsSpace: true
    }
  }
  return null
}

export function isWindowsPathStyle (cwd = '', isRemote = false) {
  if (isRemote) {
    return false
  }
  return /^[a-zA-Z]:[\\/]/.test(cwd) || (cwd && cwd.includes('\\'))
}

export function isAbsolutePath (p, win) {
  if (!p) {
    return false
  }
  if (win) {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
  }
  return p.startsWith('/')
}

function pickSep (arg, win) {
  if (arg.includes('/') && !arg.includes('\\')) {
    return '/'
  }
  if (arg.includes('\\')) {
    return '\\'
  }
  return win ? '\\' : '/'
}

export function splitArgPath (arg, win) {
  const sep = pickSep(arg, win)
  const i = Math.max(arg.lastIndexOf('/'), arg.lastIndexOf('\\'))
  if (i === -1) {
    return { dirRel: '', namePrefix: arg, sep }
  }
  return {
    dirRel: arg.slice(0, i + 1),
    namePrefix: arg.slice(i + 1),
    sep
  }
}

export function resolveListDir (cwd, dirRel, win) {
  if (isAbsolutePath(dirRel, win)) {
    return dirRel
  }
  const sep = win ? '\\' : '/'
  const base = String(cwd || '').replace(/[\\/]+$/, '')
  if (!dirRel) {
    return base
  }
  const rel = dirRel.replace(/[\\/]+$/, '').replace(/^[\\/]+/, '')
  if (!base) {
    return dirRel
  }
  return base + sep + rel.replace(/\//g, sep).replace(/\\/g, sep)
}

export function quotePathArg (name) {
  if (!name) {
    return name
  }
  if (/[\s'"$&*;<>?()[\]{}]/.test(name)) {
    if (name.includes("'") && !name.includes('"')) {
      return `"${name}"`
    }
    return `'${name.replace(/'/g, '\'\\\'\'')}'`
  }
  return name
}

export function formatPathSuggestions (cmd, entries = [], ctx = {}) {
  const parsed = parsePathCommand(cmd)
  if (!parsed) {
    return []
  }
  const win = !!ctx.win
  const { dirRel, namePrefix, sep } = splitArgPath(parsed.arg, win)
  const lower = namePrefix.toLowerCase()
  const res = []
  for (const item of entries) {
    if (!item || !item.name || item.name === '.' || item.name === '..') {
      continue
    }
    if (parsed.dirsOnly && !item.isDirectory) {
      continue
    }
    if (lower && !item.name.toLowerCase().startsWith(lower)) {
      continue
    }
    const named = quotePathArg(item.name)
    const trail = item.isDirectory ? sep : ''
    const command = parsed.prefix + dirRel + named + trail
    if (command === cmd && parsed.needsSpace) {
      continue
    }
    res.push(command)
    if (res.length >= MAX_PATH_ITEMS) {
      break
    }
  }
  return res
}
