/**
 * 网络地址工具：枚举本机可供局域网内其他设备访问的 IPv4 地址，
 * 供「邀请其他人加入本局」与客户端展示访问地址使用。
 */
const os = require('os');

/** IPv4 私网段优先级：家庭/办公路由器网段优先，虚拟网卡与 APIPA 地址靠后 */
const RANGES = [
  { test: (a) => a.startsWith('192.168.'), score: 3 },
  { test: (a) => a.startsWith('10.'), score: 2 },
  { test: (a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a), score: 1 },
];

function scoreOf(addr) {
  if (!addr) return -99;
  if (addr.startsWith('169.254.')) return -1;  // APIPA：未从路由器拿到地址，通常不可用
  if (addr.startsWith('127.')) return -99;
  for (const r of RANGES) if (r.test(addr)) return r.score;
  return 0;
}

/**
 * 返回本机非回环 IPv4 地址，按「最可能被同 Wi-Fi 设备访问」排序并去重。
 * @returns {{address:string, iface:string, score:number}[]}
 */
function localIPs() {
  const seen = new Set();
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (!isV4 || net.internal) continue;
      const score = scoreOf(net.address);
      if (score < 0 || seen.has(net.address)) continue;
      seen.add(net.address);
      out.push({ address: net.address, iface: name, score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return out;
}

/**
 * 组装 /api/net 的响应体。
 * @param {{headers?:object}} req  Express 请求对象（可为空，便于单测复用）
 * @param {number} port           服务监听端口
 */
function netInfo(req, port) {
  const ips = localIPs();
  const primary = ips.length ? ips[0].address : '';
  const host = req && req.headers ? (req.headers.host || '') : '';
  return {
    ok: true,
    port,
    host,                                   // 当前请求的 Host 头
    current: host,                          // 兼容旧字段（同 host）
    hostname: os.hostname(),                // 本机计算机名
    ips: ips.map((i) => i.address),         // 可直接用于组局域网链接
    interfaces: ips.map(({ address, iface }) => ({ address, iface })),
    primary,                                // 推荐地址（最可能是同网段的那个）
    urls: ips.map((i) => `http://${i.address}:${port}`),
    lanUrl: primary ? `http://${primary}:${port}` : '',
    localUrl: `http://localhost:${port}`,
    time: Date.now(),
  };
}

module.exports = { localIPs, netInfo, scoreOf };
