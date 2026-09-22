/**
 * Built-in quick command templates for Ops Command Center
 * Placeholders: {name} style
 */

export const commandCategories = [
  'file',
  'disk',
  'network',
  'process',
  'docker',
  'system'
]

export const builtinTemplates = [
  {
    id: 'tpl-ls',
    category: 'file',
    name: '列出目录',
    command: 'ls -lah {path}',
    danger: 'safe',
    desc: '详细列出目录内容',
    params: [{ key: 'path', label: '路径', default: '.', required: true, tip: '目录路径' }],
    examples: [{ cmd: 'ls -lah /var/log', note: '看日志目录' }],
    notes: '权限不足会报错'
  },
  {
    id: 'tpl-find-name',
    category: 'file',
    name: '按名查找文件',
    command: 'find {path} -name "{pattern}" 2>/dev/null | head -50',
    danger: 'safe',
    desc: '在目录下按名称查找',
    params: [
      { key: 'path', label: '起始路径', default: '.', required: true },
      { key: 'pattern', label: '文件名模式', default: '*.log', required: true }
    ],
    examples: [{ cmd: 'find / -name "*.conf"', note: '全盘找配置' }],
    notes: '大目录可能较慢'
  },
  {
    id: 'tpl-du',
    category: 'disk',
    name: '目录占用',
    command: 'du -sh {path}/* 2>/dev/null | sort -hr | head -20',
    danger: 'safe',
    desc: '查看子目录占用排序',
    params: [{ key: 'path', label: '路径', default: '.', required: true }],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-df',
    category: 'disk',
    name: '磁盘使用',
    command: 'df -hT',
    danger: 'safe',
    desc: '查看挂载与容量',
    params: [],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-free',
    category: 'disk',
    name: '内存使用',
    command: 'free -h',
    danger: 'safe',
    desc: '内存与 swap',
    params: [],
    examples: [],
    notes: '重点看 available'
  },
  {
    id: 'tpl-ping',
    category: 'network',
    name: 'Ping 连通性',
    command: 'ping -c {count} {host}',
    danger: 'safe',
    desc: '测试网络连通',
    params: [
      { key: 'host', label: '主机', default: '8.8.8.8', required: true },
      { key: 'count', label: '次数', default: '4', required: true }
    ],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-ss',
    category: 'network',
    name: '监听端口',
    command: 'ss -lntp',
    danger: 'safe',
    desc: '查看监听端口与进程',
    params: [],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-port',
    category: 'network',
    name: '查端口占用',
    command: 'ss -lntp | grep :{port} || netstat -lntp 2>/dev/null | grep :{port}',
    danger: 'safe',
    desc: '查找占用指定端口的进程',
    params: [{ key: 'port', label: '端口', default: '80', required: true }],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-ps',
    category: 'process',
    name: 'CPU Top',
    command: 'ps aux --sort=-%cpu | head -{n}',
    danger: 'safe',
    desc: 'CPU 占用最高进程',
    params: [{ key: 'n', label: '条数', default: '15', required: true }],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-kill',
    category: 'process',
    name: '结束进程',
    command: 'kill -{signal} {pid}',
    danger: 'danger',
    desc: '向进程发送信号',
    params: [
      { key: 'pid', label: 'PID', default: '', required: true },
      { key: 'signal', label: '信号', default: '15', required: true, tip: '15=TERM 9=KILL' }
    ],
    examples: [{ cmd: 'kill -15 1234', note: '优雅停止' }],
    notes: '确认 PID 正确'
  },
  {
    id: 'tpl-docker-ps',
    category: 'docker',
    name: '容器列表',
    command: 'docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}"',
    danger: 'safe',
    desc: '列出全部容器',
    params: [],
    examples: [],
    notes: '需已安装 docker'
  },
  {
    id: 'tpl-docker-logs',
    category: 'docker',
    name: '容器日志',
    command: 'docker logs --tail {lines} {name}',
    danger: 'safe',
    desc: '查看容器最近日志',
    params: [
      { key: 'name', label: '容器名/ID', default: '', required: true },
      { key: 'lines', label: '行数', default: '100', required: true }
    ],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-docker-restart',
    category: 'docker',
    name: '重启容器',
    command: 'docker restart {name}',
    danger: 'confirm',
    desc: '重启指定容器',
    params: [{ key: 'name', label: '容器名/ID', default: '', required: true }],
    examples: [],
    notes: '会造成短暂中断'
  },
  {
    id: 'tpl-uptime',
    category: 'system',
    name: '运行时长与负载',
    command: 'uptime; hostnamectl 2>/dev/null || uname -a',
    danger: 'safe',
    desc: '主机概览',
    params: [],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-reboot',
    category: 'system',
    name: '重启机器',
    command: 'reboot',
    danger: 'danger',
    desc: '重启操作系统',
    params: [],
    examples: [],
    notes: '高危！确认窗口期'
  },
  {
    id: 'tpl-journal',
    category: 'system',
    name: '服务日志',
    command: 'journalctl -u {unit} -n {lines} --no-pager',
    danger: 'safe',
    desc: '查看 systemd 服务日志',
    params: [
      { key: 'unit', label: '服务名', default: 'nginx', required: true },
      { key: 'lines', label: '行数', default: '50', required: true }
    ],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-chmod',
    category: 'file',
    name: '修改权限',
    command: 'chmod {mode} {path}',
    danger: 'confirm',
    desc: '修改文件权限',
    params: [
      { key: 'mode', label: '权限', default: '755', required: true },
      { key: 'path', label: '路径', default: '', required: true }
    ],
    examples: [{ cmd: 'chmod 644 a.conf', note: '配置文件常见权限' }],
    notes: ''
  },
  {
    id: 'tpl-rm',
    category: 'file',
    name: '删除文件',
    command: 'rm -rf {path}',
    danger: 'danger',
    desc: '递归强制删除',
    params: [{ key: 'path', label: '路径', default: '', required: true }],
    examples: [],
    notes: '不可恢复，优先用回收站向导'
  },
  {
    id: 'tpl-tar-cz',
    category: 'file',
    name: '打包 tar.gz',
    command: 'tar -czf {out} {src}',
    danger: 'safe',
    desc: '压缩目录/文件',
    params: [
      { key: 'src', label: '源路径', default: '', required: true },
      { key: 'out', label: '输出文件', default: 'archive.tar.gz', required: true }
    ],
    examples: [],
    notes: ''
  },
  {
    id: 'tpl-systemctl',
    category: 'system',
    name: '服务操作',
    command: 'systemctl {action} {unit}',
    danger: 'confirm',
    desc: 'systemctl 启停重启',
    params: [
      { key: 'action', label: '动作', default: 'status', required: true, tip: 'start/stop/restart/status' },
      { key: 'unit', label: '服务', default: '', required: true }
    ],
    examples: [],
    notes: 'restart/stop 需确认'
  }
]

export function renderTemplate (command, values = {}) {
  return String(command || '').replace(/\{(\w+)\}/g, (_, key) => {
    const v = values[key]
    return v == null ? '' : String(v)
  })
}
