// JSON 文件存储层：内存缓存 + 临时文件原子写入
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, fallback) {
  if (cache.has(name)) return cache.get(name);
  const fp = filePath(name);
  if (!fs.existsSync(fp)) {
    if (fallback === undefined) throw new Error(`数据文件缺失: ${name}.json`);
    save(name, fallback);
    return cache.get(name);
  }
  try {
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    cache.set(name, obj);
    return obj;
  } catch (e) {
    throw new Error(`数据文件损坏: ${name}.json (${e.message})`);
  }
}

function save(name, obj) {
  const fp = filePath(name);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
  cache.set(name, obj);
}

module.exports = { load, save, DATA_DIR };
