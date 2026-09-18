import type { PcmBuffer } from './types';

/** fmt 区块：8 字节区块头 + 16 字节 PCM 数据 */
const FMT_CHUNK_BYTES = 8 + 16;
/** smpl 区块：8 字节区块头 + 60 字节区块体（含 1 个 24 字节循环点） */
const SMPL_CHUNK_BYTES = 8 + 60;
/** data 负载之前的全部固定开销：12 RIFF 头 + fmt + smpl + 8 字节 data 头 */
const HEADER_BYTES = 12 + FMT_CHUNK_BYTES + SMPL_CHUNK_BYTES + 8;

/** 导出文件总大小（字节），供界面在下载前预估。 */
export function wavByteLength(frames: number, channels: number): number {
  return HEADER_BYTES + frames * channels * 2;
}

/** 浮点采样夹取到 [-1,1] 后量化为 16-bit 有符号整数。 */
function quantize16(v: number): number {
  const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(clamped * 32767);
}

/**
 * 把循环 PCM 编码为 16-bit little-endian WAV，并写入 smpl 区块
 * （loop 0：dwStart=0，dwEnd=最后一帧 L−1，dwType=0 前向循环）。
 * 多声道按帧交错写入。
 */
export function encodeLoopWav(pcm: PcmBuffer): ArrayBuffer {
  const channels = pcm.channels.length;
  const frames = channels > 0 ? pcm.channels[0].length : 0;
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const v = new DataView(buffer);
  let p = 0;

  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i));
  };
  const u16 = (x: number) => {
    v.setUint16(p, x, true);
    p += 2;
  };
  const u32 = (x: number) => {
    v.setUint32(p, x >>> 0, true);
    p += 4;
  };
  const i32 = (x: number) => {
    v.setInt32(p, x, true);
    p += 4;
  };

  // ---- RIFF / WAVE 头（12 字节）----
  writeAscii('RIFF');
  u32(4 + FMT_CHUNK_BYTES + SMPL_CHUNK_BYTES + 8 + dataBytes); // 后续所有区块总长度
  writeAscii('WAVE');

  // ---- fmt 区块（24 字节）----
  writeAscii('fmt ');
  u32(16); // PCM fmt 数据长度
  u16(1); // wFormatTag = PCM
  u16(channels);
  u32(pcm.sampleRate);
  u32(pcm.sampleRate * channels * 2); // 平均字节率
  u16(channels * 2); // 块对齐
  u16(16); // 位深

  // ---- smpl 区块（68 字节：60 字节区块体 + 1 个 24 字节循环点）----
  writeAscii('smpl');
  u32(60); // 区块体长度
  u32(0); // dwManufacturer
  u32(0); // dwProduct
  u32(0); // dwSamplePeriod
  u32(60); // dwMIDIUnityNote（60 = C4）
  u32(0); // dwMIDIPitchFraction
  u32(0); // dwSMPTEFormat
  u32(0); // dwSMPTEOffset
  u32(1); // cSampleLoops
  u32(0); // cbSamplerData
  // SamplerLoop（24 字节）
  u32(0); // dwIdentifier
  u32(0); // dwType = 0（前向循环）
  u32(0); // dwStart
  u32(Math.max(0, frames - 1)); // dwEnd（最后一帧）
  u32(0); // dwFraction
  i32(0); // dwPlayCount（0 = 无限循环）

  // ---- data 区块：按帧交错、夹取量化后写入 ----
  writeAscii('data');
  u32(dataBytes);
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      v.setInt16(p, quantize16(pcm.channels[ch][i]), true);
      p += 2;
    }
  }

  return buffer;
}
