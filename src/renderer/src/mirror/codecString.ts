/**
 * 从 Annex-B 格式的 H.264 配置包（SPS/PPS）生成 WebCodecs 的 codec 字符串 avc1.PPCCLL。
 */
export function h264CodecString(config: Uint8Array): string | undefined {
  const sps = findNal(config, 7)
  if (!sps || sps.length < 4) return undefined
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  // sps[0] 是 NAL 头，之后依次为 profile_idc、constraint flags、level_idc
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`
}

/** 查找第一个指定类型的 NAL 单元（含 NAL 头，不含起始码） */
export function findNal(data: Uint8Array, nalType: number): Uint8Array | undefined {
  const starts: number[] = []
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3)
      i += 2
    }
  }
  for (let k = 0; k < starts.length; k++) {
    const begin = starts[k]
    if ((data[begin] & 0x1f) !== nalType) continue
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : data.length
    // 4 字节起始码 00 00 00 01 的前导 0 不属于本 NAL
    if (k + 1 < starts.length && end > begin && data[end - 1] === 0) end--
    return data.subarray(begin, end)
  }
  return undefined
}
