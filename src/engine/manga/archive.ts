/* ============================================================
 * bz-reader · 漫画压缩包（engine/manga/archive.ts）
 *
 * CBZ 就是 zip：这里只读中央目录，按名字按需解压单张图，不整本进内存、
 * 不整本转 base64。理由见 data/cover.ts 那条实测——100MB 的漫画为一张
 * 200px 封面把整本读进来，手机上会卡甚至 OOM。
 *
 * 不引入新依赖：zip 的 store(0) / deflate(8) 两种条目用浏览器自带的
 * DecompressionStream('deflate-raw') 解，RAR / 7z 这类格式一期不支持。
 * 中央目录解析是纯函数，可以脱离 DOM 单测。
 * ============================================================ */
import { naturalCompare, sortPageNames } from './layout';

export interface ZipEntry {
  name: string;
  /** 0 = 直接存，8 = deflate */
  method: number;
  compressedSize: number;
  size: number;
  /** 压缩数据在文件里的起点 */
  dataOffset: number;
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.avif', '.jxl'];

export function isImageName(name: string): boolean {
  const n = String(name ?? '').toLowerCase();
  return IMAGE_EXT.some((ext) => n.endsWith(ext));
}

/** zip 里的路径分隔符统一成 /，去掉 __MACOSX 之类的资源叉 */
function cleanName(name: string): string {
  return name.replace(/\\/g, '/');
}

export function isNoiseEntry(name: string): boolean {
  const n = cleanName(name).toLowerCase();
  return n.startsWith('__macosx/') || n.endsWith('/') || /(^|\/)(\._|\.ds_store)/.test(n);
}

/**
 * 解析 zip 中央目录。倒着找 EOCD 是为了兼容注释长度不定的包；
 * 找不到就抛，让上层给「文件坏了」而不是白屏。
 */
export function parseZipDirectory(buf: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');

  const total = u16(eocd + 10);
  let at = u32(eocd + 16);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) break;
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    const name = cleanName(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen)));
    const local = u32(at + 42);
    /* 本地头里的文件名/附加字段长度可能与中央目录不同，必须以本地头为准 */
    let dataOffset = -1;
    if (local + 30 <= bytes.length && u32(local) === 0x04034b50) {
      dataOffset = local + 30 + u16(local + 26) + u16(local + 28);
    }
    out.push({
      name,
      method: u16(at + 10),
      compressedSize: u32(at + 20),
      size: u32(at + 24),
      dataOffset,
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 页清单：只认图片、丢资源叉、按自然序排；外层目录名不参与排序比较 */
export function comicPageNames(entries: readonly ZipEntry[]): string[] {
  const names = entries
    .filter((e) => e.dataOffset >= 0 && isImageName(e.name) && !isNoiseEntry(e.name))
    .map((e) => e.name);
  return sortPageNames(names).map((n) => n);
}

/** ComicInfo.xml 可能藏在子目录里 */
export function comicInfoName(entries: readonly ZipEntry[]): string | null {
  const hit = entries.find((e) => /(^|\/)comicinfo\.xml$/i.test(e.name));
  return hit ? hit.name : null;
}

/** 用宿主浏览器自带的流解压，避免把整个包留给 zip.js 的 worker */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    if (part.value) chunks.push(part.value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export interface MangaSource {
  readonly pages: string[];
  readonly groups: Array<{ label: string; page: number }>;
  blob(name: string): Promise<Blob | null>;
  text(name: string): Promise<string>;
  cover(): Promise<Blob | null>;
}

/** 图片 MIME：zip 里没有类型信息，只能按后缀猜；认不出就交浏览器兜底 */
export function imageMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.svg')) return 'image/svg+xml';
  if (n.endsWith('.bmp')) return 'image/bmp';
  if (n.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg';
}

/**
 * 一本漫画的只读句柄。整块 ArrayBuffer 由调用方持有（readBinary 一次），
 * 这里只按名字切出单张图的 Blob；用完由视图层 revokeObjectURL。
 */
export class ComicArchive implements MangaSource {
  readonly entries: ZipEntry[];
  readonly pages: string[];
  /** 目录条目：同一卷里按文件夹分「话」，没有分层时为空 */
  readonly groups: Array<{ label: string; page: number }>;

  private readonly buf: ArrayBuffer;
  private readonly byName = new Map<string, ZipEntry>();

  constructor(buf: ArrayBuffer) {
    this.buf = buf;
    this.entries = parseZipDirectory(buf);
    this.pages = comicPageNames(this.entries);
    for (const e of this.entries) this.byName.set(e.name, e);
    const seen = new Set<string>();
    this.groups = [];
    this.pages.forEach((name, page) => {
      const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        this.groups.push({ label: dir.split('/').pop() || dir, page });
      }
    });
  }

  get count(): number { return this.pages.length; }

  /** 只解压这一张图；坏条目返回 null，视图层跳过而不是整本作废 */
  async blob(name: string): Promise<Blob | null> {
    const e = this.byName.get(name);
    if (!e || e.dataOffset < 0) return null;
    try {
      const raw = new Uint8Array(this.buf, e.dataOffset, e.compressedSize);
      const type = imageMime(name);
      if (e.method === 0) return new Blob([raw], { type });
      if (e.method === 8) return new Blob([await inflateRaw(raw)], { type });
      return null;
    } catch {
      return null;
    }
  }

  async text(name: string): Promise<string> {
    const blob = await this.blob(name);
    return blob ? blob.text() : '';
  }

  /** 封面只取第一张图，不读整本 */
  async cover(): Promise<Blob | null> {
    return this.pages.length ? this.blob(this.pages[0]) : null;
  }

  /** 文件名自然序（供目录、页码显示用） */
  static compare = naturalCompare;
}
