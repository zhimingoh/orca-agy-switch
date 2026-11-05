import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const root = path.join(os.homedir(), '.orca', 'agy-switch');
const profile = path.join(root, 'gemini');
const defaultModel = 'Gemini 4 Argon (Medium)';
const dirFlag = /(?:^|\s)--gemini[_-]dir(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/g;

function runtimeClient() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const userData = process.env.ORCA_USER_DATA_PATH || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'orca')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'orca')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'orca'));
  const candidates = [
    process.resourcesPath,
    path.join(localAppData, 'Programs', 'orca', 'resources'),
    '/Applications/Orca.app/Contents/Resources',
    path.join(os.homedir(), 'Applications', 'Orca.app', 'Contents', 'Resources')
  ].filter(Boolean);
  for (const resources of candidates) {
    const file = path.join(resources, 'app.asar.unpacked', 'out', 'cli', 'runtime-client.js');
    if (fs.existsSync(file)) return new (require(file).RuntimeClient)(userData);
  }
  throw new Error('未找到 Orca 设置接口，请检查 Orca 安装位置。');
}

function userArgs(settings) {
  return settings.agentChoices?.userArgs?.antigravity
    ?? settings.agentPermission?.userArgs?.antigravity
    ?? settings.agentDefaultArgs?.antigravity ?? '';
}

function checkedConfig(input) {
  const url = new URL(String(input.url ?? '').trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('URL 应为 http/https 接口地址，不要带用户名、密码、查询参数或 #。');
  }
  const model = String(input.model ?? '').trim();
  if (!model || model.length > 200 || /[\r\n\0]/.test(model)) throw new Error('请填写有效的模型显示名。');
  return { url: url.toString().replace(/\/$/, ''), model };
}

function agyExecutable() {
  const explicit = process.env.AGY_CLI_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform === 'win32') {
    const packages = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(packages)) {
      for (const name of fs.readdirSync(packages).filter(name => name.startsWith('Google.AntigravityCLI_'))) {
        const file = path.join(packages, name, 'agy.exe');
        if (fs.existsSync(file)) return file;
      }
    }
    return 'agy.exe';
  }
  for (const file of ['/opt/homebrew/bin/agy', '/usr/local/bin/agy', path.join(os.homedir(), '.local', 'bin', 'agy')]) {
    if (fs.existsSync(file)) return file;
  }
  return 'agy';
}

function prepareProfile(model) {
  const cli = path.join(profile, 'antigravity-cli');
  fs.mkdirSync(cli, { recursive: true });
  const file = path.join(cli, 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, modelProvider: 'gemini', model }, null, 2));
  const shared = path.join(os.homedir(), '.gemini', 'config');
  const target = path.join(profile, 'config');
  if (!fs.existsSync(target)) {
    if (fs.existsSync(shared)) fs.symlinkSync(shared, target, process.platform === 'win32' ? 'junction' : 'dir');
    else fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
  }
}

export default async function activate(orca) {
  const client = runtimeClient();
  let pending = Promise.resolve();
  const serial = handler => input => {
    const next = pending.then(() => handler(input));
    pending = next.catch(() => {});
    return next;
  };

  async function config() {
    return await orca.storage.get('relay') ?? { url: 'https://example.com/antigravity', model: defaultModel };
  }

  async function state() {
    const saved = await config();
    const key = await orca.secrets.get('api-key');
    const settings = (await client.call('settings.get')).result.settings;
    const launch = (await client.call('settings.getAgentLaunch')).result.settings;
    const env = settings.agentDefaultEnv?.antigravity ?? {};
    const args = userArgs(launch);
    const dirs = [...args.matchAll(new RegExp(dirFlag.source, 'g'))];
    const ours = dirs.some(match => match[0].includes(profile));
    const mode = key && ours && env.GEMINI_API_KEY === key && env.GOOGLE_GEMINI_BASE_URL === saved.url
      ? 'relay'
      : !env.GEMINI_API_KEY && !env.GOOGLE_GEMINI_BASE_URL && dirs.length === 0 ? 'official' : 'custom';
    const labels = { relay: '中转站', official: '官方账号', custom: '其他配置' };
    await orca.host.call('statusBar.update', { id: 'mode', text: 'AGY · ' + labels[mode], tooltip: '新开的 AGY 会话使用：' + labels[mode] });
    return { ...saved, hasKey: Boolean(key), mode, modeLabel: labels[mode] };
  }

  async function apply(mode) {
    if (!['relay', 'official'].includes(mode)) throw new Error('未知连接模式。');
    const saved = await config();
    const key = mode === 'relay' ? await orca.secrets.get('api-key') : null;
    if (mode === 'relay' && !key) throw new Error('请先填写并保存 API Key。');
    if (mode === 'relay') {
      checkedConfig(saved);
      prepareProfile(saved.model);
    }
    const before = (await client.call('settings.get')).result.settings;
    const launch = (await client.call('settings.getAgentLaunch')).result.settings;
    const previousEnv = before.agentDefaultEnv?.antigravity ?? {};
    const previousArgs = userArgs(launch);
    const base = previousArgs.replace(dirFlag, '').trim();
    const nextArgs = mode === 'relay' ? [base, `--gemini_dir="${profile}"`].filter(Boolean).join(' ') : base;
    try {
      for (const name of ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']) {
        await client.call('settings.mutateAgentLaunch', mode === 'relay'
          ? { type: 'environment-set', agent: 'antigravity', name, value: name === 'GEMINI_API_KEY' ? key : saved.url }
          : { type: 'environment-remove', agent: 'antigravity', name });
      }
      await client.call('settings.mutateAgentLaunch', { type: 'user-arguments', agent: 'antigravity', value: nextArgs });
      const after = await state();
      if (after.mode !== mode) throw new Error('配置读回校验失败。');
      return after;
    } catch (error) {
      for (const name of ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']) {
        await client.call('settings.mutateAgentLaunch', name in previousEnv
          ? { type: 'environment-set', agent: 'antigravity', name, value: previousEnv[name] }
          : { type: 'environment-remove', agent: 'antigravity', name });
      }
      await client.call('settings.mutateAgentLaunch', { type: 'user-arguments', agent: 'antigravity', value: previousArgs });
      throw error;
    }
  }

  orca.panels.handle('connection.state', serial(state));
  orca.panels.handle('connection.save', serial(async input => {
    const saved = checkedConfig(input ?? {});
    const key = String(input?.key ?? '').trim();
    if (key) {
      if (/[\r\n\0]/.test(key)) throw new Error('Key 不能包含换行。');
      await orca.secrets.set('api-key', key);
    }
    if (!key && !await orca.secrets.get('api-key')) throw new Error('首次保存请填写 API Key。');
    await orca.storage.set('relay', saved);
    return state();
  }));
  orca.panels.handle('connection.switch', serial(input => apply(input?.mode)));
  orca.panels.handle('connection.test', serial(async () => {
    const saved = await config();
    const key = await orca.secrets.get('api-key');
    if (!key) throw new Error('请先保存 API Key。');
    prepareProfile(saved.model);
    try {
      const result = await run(agyExecutable(), [
        '--gemini_dir=' + profile, '--model=' + saved.model, '--mode=plan',
        '--print-timeout=40s', '--print', 'Reply with exactly AGY_RELAY_OK. Do not use any tools.'
      ], {
        env: { ...process.env, GEMINI_API_KEY: key, GOOGLE_GEMINI_BASE_URL: saved.url },
        cwd: root, timeout: 50000, maxBuffer: 1024 * 1024, windowsHide: true
      });
      if (!result.stdout.trim().includes('AGY_RELAY_OK')) throw new Error('请求结束，但模型没有返回预期的测试文本。');
      return { ok: true, message: '中转连接成功，AGY 已返回 AGY_RELAY_OK。' };
    } catch (error) {
      const detail = String(error.stderr || error.message).split(key).join('[已隐藏]');
      throw new Error('连接测试失败：' + detail.slice(0, 1600));
    }
  }));

  await state();
}
