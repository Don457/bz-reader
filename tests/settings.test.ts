import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

/**
 * exportDir / importDir 是自由文本框。以前只收首尾斜杠，`../x` 会让导出写到
 * 数据目录（甚至库）之外；这里与 normalizeDataDir 同口径：按段过滤。
 */
describe('目录设置收口', () => {
  it('上跳段被丢弃', () => {
    expect(normalizeSettings({ exportDir: '../外面' }).exportDir).toBe('外面');
    expect(normalizeSettings({ exportDir: '书摘/../../外面' }).exportDir).toBe('书摘/外面');
  });

  it('. 段与点开头的隐藏目录被丢弃', () => {
    expect(normalizeSettings({ exportDir: './书摘' }).exportDir).toBe('书摘');
    expect(normalizeSettings({ exportDir: '.obsidian/plugins/x' }).exportDir).toBe('plugins/x');
  });

  it('正常多级目录原样保留，反斜杠转正斜杠', () => {
    expect(normalizeSettings({ exportDir: '阅读\\书摘' }).exportDir).toBe('阅读/书摘');
  });

  it("'/' 仍然表示库根目录（不是空值）", () => {
    expect(normalizeSettings({ exportDir: '/' }).exportDir).toBe('/');
  });

  it('空串回落到默认目录', () => {
    expect(normalizeSettings({ exportDir: '   ' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
    expect(normalizeSettings({ exportDir: '..' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
  });

  it('importDir 用同一套规则，但回落到自己的默认值', () => {
    expect(normalizeSettings({ importDir: '../x' }).importDir).toBe('x');
    expect(normalizeSettings({ importDir: '' }).importDir).toBe(DEFAULT_SETTINGS.importDir);
  });
});

/**
 * 在线语音组（2026-11-14）：以前朗读借 AI 组的地址与密钥，现在自带一份。
 * 升级时若这份配置根本不存在，必须从 AI 组搬一次，否则老用户点朗读
 * 直接变「没配置」——这是事故。
 */
describe('在线语音设置', () => {
  it('老数据没有 ttsOnline：把 AI 组的地址与密钥搬过来', () => {
    const s = normalizeSettings({ ai: { baseUrl: 'https://proxy.example.com', apiKey: 'sk-old' } });
    expect(s.ttsOnline).toEqual({ url: 'https://proxy.example.com', model: '', apiKey: 'sk-old', format: 'mp3' });
  });

  it('AI 组也没配：预填官方地址，密钥留空', () => {
    const s = normalizeSettings({});
    expect(s.ttsOnline.url).toBe('https://api.deepseek.com');
    expect(s.ttsOnline.apiKey).toBe('');
  });

  it('本地地址预填本机默认端口，用户照着改即可', () => {
    expect(normalizeSettings({}).ttsLocal.url).toBe('http://127.0.0.1:8880');
  });

  it('用户自己清空本地地址：保持空，不再填回来', () => {
    expect(normalizeSettings({ ttsLocal: { url: '', model: '', apiKey: '', format: 'mp3' } }).ttsLocal.url).toBe('');
  });

  it('已经有 ttsOnline：用户清空就保持空，不再回填 AI 组的值', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-ai' },
      ttsOnline: { url: '', model: '', apiKey: '', format: 'mp3' },
    });
    expect(s.ttsOnline.url).toBe('');
    expect(s.ttsOnline.apiKey).toBe('');
  });

  it('地址按云端口径补协议：本机 / 内网补 http，域名补 https', () => {
    const withUrl = (url: string): string => normalizeSettings({ ttsOnline: { url, model: '', apiKey: '' } }).ttsOnline.url;
    expect(withUrl('127.0.0.1:8880')).toBe('http://127.0.0.1:8880');
    expect(withUrl('localhost:8880')).toBe('http://localhost:8880');
    expect(withUrl('192.168.1.9:9000')).toBe('http://192.168.1.9:9000');
    expect(withUrl('api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(withUrl('https://tts.example.com/')).toBe('https://tts.example.com');
  });

  it('模型名去掉首尾空格：粘进来常带', () => {
    const s = normalizeSettings({ ttsOnline: { url: '', model: '  cosyvoice-2 ', apiKey: '' } });
    expect(s.ttsOnline.model).toBe('cosyvoice-2');
  });
});

/**
 * 扫描页识别（2026-11-15）：不再借 AI 组，自带地址 / 密钥 / 通道。
 *
 * 老数据只有扁平的 `pdfOcrEngine` / `pdfOcrUrl`。升级时按「pdfOcr 对象在不在」
 * 判断要不要搬：`vision` 改成官方 OCR 并从 AI 组抄一份密钥；`http` 保留地址。
 * 对象存在之后，用户清空密钥不会再被 AI 组填回来。
 */
/**
 * 「加入复习先选方式」这个开关已删（2026-11-21）：制卡流程整体搬进 bz Review
 * 之后，Reader 里没有任何代码读它；「要不要问我」现在是 Review 设置里的
 * 「新卡默认方式」，Reader 不再保留一份同义开关。
 */
describe('扫描页识别设置', () => {
  it('老数据用 AI 看图：改成 DeepSeek 看图，密钥与模型从 AI 组搬一份', () => {
    const s = normalizeSettings({ ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-ai', model: 'deepseek-flash' } });
    expect(s.pdfOcr.engine).toBe('deepseek');
    expect(s.pdfOcr.baseUrl).toBe('https://api.deepseek.com');
    expect(s.pdfOcr.apiKey).toBe('sk-ai');
    expect(s.pdfOcr.model).toBe('deepseek-flash');
  });

  it('老数据用外部服务：地址保留，通道仍是 http', () => {
    const s = normalizeSettings({ pdfOcrEngine: 'http', pdfOcrUrl: 'http://127.0.0.1:1224/api/ocr' });
    expect(s.pdfOcr.engine).toBe('http');
    expect(s.pdfOcr.url).toBe('http://127.0.0.1:1224/api/ocr');
  });

  it('已经有独立配置：清空密钥就保持空，不再回填 AI 组', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-ai', model: 'x' },
      pdfOcr: { engine: 'deepseek', baseUrl: '', apiKey: '', url: '' },
    });
    expect(s.pdfOcr.apiKey).toBe('');
    /* 地址清空 = 用回官方默认，免得拼出一个没有主机的接口地址 */
    expect(s.pdfOcr.baseUrl).toBe('https://api.deepseek.com');
    /* 模型清空 = 用回 deepseek-flash */
    expect(s.pdfOcr.model).toBe('deepseek-flash');
  });

  it('通道值只认 deepseek / http，写坏了退回官方 OCR', () => {
    expect(normalizeSettings({ pdfOcr: { engine: 'vision' } }).pdfOcr.engine).toBe('deepseek');
  });
});

/** 双链模板设置：两套独立配置（整本导出 / 复制划线），老数据没有 → 退回默认 */
describe('双链模板设置', () => {
  it('老数据缺省 → 两套都是简洁档 + 空自定义，导出格式与升级前一致', () => {
    const s = normalizeSettings({});
    expect(s.exportTemplate).toBe('simple');
    expect(s.exportTemplateCustom).toBe('');
    expect(s.copyTemplate).toBe('simple');
    expect(s.copyTemplateCustom).toBe('');
  });

  it('导出模板只认四个 id，写坏了退回 simple', () => {
    expect(normalizeSettings({ exportTemplate: 'quote' }).exportTemplate).toBe('quote');
    expect(normalizeSettings({ exportTemplate: 'detail' }).exportTemplate).toBe('detail');
    expect(normalizeSettings({ exportTemplate: 'custom' }).exportTemplate).toBe('custom');
    expect(normalizeSettings({ exportTemplate: '乱写' }).exportTemplate).toBe('simple');
  });

  it('复制与导出是同一组 id：quote 合法，旧的 brief 写坏了退回 simple', () => {
    expect(normalizeSettings({ copyTemplate: 'simple' }).copyTemplate).toBe('simple');
    expect(normalizeSettings({ copyTemplate: 'quote' }).copyTemplate).toBe('quote');
    expect(normalizeSettings({ copyTemplate: 'detail' }).copyTemplate).toBe('detail');
    expect(normalizeSettings({ copyTemplate: 'custom' }).copyTemplate).toBe('custom');
    expect(normalizeSettings({ copyTemplate: 'brief' }).copyTemplate).toBe('simple');
  });

  /* 2026-11-24：不再 trim。嵌在列表项下的 callout 靠行首缩进成立，
     首尾空行也是模板的一部分——吃掉一次，下次启动模板就悄悄变样。 */
  it('自定义模板原样保留（含首尾空白与行首缩进）', () => {
    const tpl = '\n  > [!note] {书名}\n  > {双链}\n  ';
    expect(normalizeSettings({ exportTemplateCustom: tpl }).exportTemplateCustom).toBe(tpl);
    expect(normalizeSettings({ copyTemplateCustom: '《{书名}》\n· {章节}' }).copyTemplateCustom).toBe('《{书名}》\n· {章节}');
  });

  it('老 aliasTemplate 有内容 → 迁到复制自定义档，老别名保留且必须带上可点双链', () => {
    const s = normalizeSettings({ aliasTemplate: '《{书名}》\n· {章节}' });
    expect(s.copyTemplate).toBe('custom');
    /* 老别名只是链接显示文字，不带 {双链}；直接当模板用会复制出纯文本，
       所以迁移时要补上双链那一行，保住「复制双链到剪贴板」这个核心行为。 */
    expect(s.copyTemplateCustom).toBe('> {双链}\n> ↳ 《{书名}》\n· {章节}');
  });

  it('老 aliasTemplate 为空 → 不迁移，复制保持简洁档', () => {
    expect(normalizeSettings({ aliasTemplate: '  ' }).copyTemplate).toBe('simple');
  });

  it('两套配置互不影响', () => {
    const s = normalizeSettings({ exportTemplate: 'quote', copyTemplate: 'detail' });
    expect(s.exportTemplate).toBe('quote');
    expect(s.copyTemplate).toBe('detail');
  });
});
