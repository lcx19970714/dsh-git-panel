/**
 * host/model-errors.js —— 把模型服务的原始错误翻成一句人话
 *
 * 为什么单独一层：界面统一是「模型调用失败：{message}」，而 provider 给的原文是
 * `Insufficient Balance (request_id: …)`、`connect ECONNREFUSED` 这种给开发者看的东西。
 * 用户看到只会疑惑「我没改代码，怎么报错了」。这里按类别翻成一句能看懂、能照做的话：
 *
 *   余额不足 → 去充值 / 换模型；密钥失效 → 重配密钥；限流 → 等一会；模型不存在 → 换模型；
 *   上下文超限 → 减少改动；断网 → 查网络。
 *
 * 原始错误仍然留在末尾（截到可读长度）：出问题时用户能把它贴给别人，
 * 也免得把信息「翻译」没了。
 *
 * 只做翻译，不做判定：到底算不算失败，由 llm-call 看 `finish.reason` 决定。
 */

/** 原始错误保留多长：够看出是哪条错误，又不至于把一条提示撑成三屏。 */
const RAW_LIMIT = 240

const clip = (text) => {
  const value = String(text).replace(/\s+/g, ' ').trim()
  return value.length <= RAW_LIMIT ? value : value.slice(0, RAW_LIMIT) + '…'
}

/**
 * 类别表：按顺序匹配第一条命中的。
 *
 * 顺序有讲究：`insufficient_quota` 既要归到余额不足，也不能先被 429 抢走；
 * 所以「余额」排在「限流」前面。匹配用的都是各家 provider 实际会吐的原文片段。
 */
const RULES = [
  {
    code: 'balance',
    test: /insufficient[_\s-]*(balance|quota|credit|funds)|exceeded your current quota|balance[_\s-]*not[_\s-]*enough|payment required|billing|余额不足|额度不足|欠费|\b402\b/i,
    reason: (target) => '模型账号余额不足（' + target + '），这次调用被拒绝了。'
      + '请到该平台充值，或在设置里换一个可用模型。'
  },
  {
    code: 'auth',
    test: /invalid[_\s-]*(api[_\s-]*key|token|credential)|incorrect api key|unauthorized|authentication|api key not valid|密钥(无效|失效|错误)|\b401\b/i,
    reason: (target) => '模型服务的密钥无效或已过期（' + target + '）。'
      + '请在 DSH 里重新配置这个 provider 的密钥。'
  },
  {
    code: 'rate-limit',
    test: /rate[_\s-]*limit|too many requests|请求(过于)?频繁|限流|\b429\b/i,
    reason: (target) => '模型服务限流了（' + target + '），这次请求被拒。'
      + '等几秒再试；经常发生的话换一个模型。'
  },
  {
    code: 'model-missing',
    test: /model[_\s-]*not[_\s-]*(found|exist)|no such model|does not exist|not have access to model|模型不存在|\b404\b/i,
    reason: (target) => '模型不存在，或当前账号无权使用它（' + target + '）。'
      + '在设置里换一个当前可用的模型。'
  },
  {
    code: 'too-long',
    test: /context[_\s-]*length|maximum context|prompt is too long|input is too long|too many tokens|token limit|超出(上下文|长度)/i,
    reason: (target) => '这次输入超过了模型的上下文上限（' + target + '）。'
      + '减少本次改动（或少暂存几个文件）再生成，或换一个上下文更大的模型。'
  },
  {
    code: 'network',
    test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|getaddrinfo/i,
    reason: (target) => '连不上模型服务（' + target + '）。检查网络、代理或 base URL 设置后重试。'
  }
]

/**
 * 把一次模型失败的原始原因翻成可读提示。
 *
 * @param {string|Error|object} raw provider 给的失败原因（字符串、Error 或 {message}）
 * @param {string} target `provider/model`，写进提示里，用户才知道是哪个模型出的问题
 * @returns {string} 一句「原因 + 下一步」的中文提示，末尾附原始错误
 */
export function describeModelFailure(raw, target) {
  const text = raw instanceof Error ? raw.message : (raw === null || raw === undefined ? '' : String(raw))
  const detail = clip(text)
  if (detail === '') return '模型服务没有给出失败原因（' + target + '），可以重试一次。'

  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.reason(target) + '原始错误：' + detail
  }
  return '模型服务返回了错误（' + target + '）。原始错误：' + detail
}
