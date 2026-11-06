'use strict'

/**
 * 阿里云实名认证 provider。
 *
 * 这里不联网：`verify()` 接受 `fetchImpl` 注入，签名与请求形态用固定输入锁住。
 * 真正打通阿里云还需要服务端 `.env` 里的 AccessKey；没有凭据时本用例仍能跑。
 */

const crypto = require('node:crypto')
const http = require('node:http')
const provider = require('../../src/services/realName/aliyun.provider')

const VALID_ID = '310101199001011234'

const BASE_SETTINGS = {
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  endpoint: 'https://cloudauth.aliyuncs.com',
  timeoutMs: 1000,
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function mockFetch(payload, { status = 200, ok = true } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return {
      ok,
      status,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    }
  }
  return { fetchImpl, calls }
}

describe('阿里云 V3 签名', () => {
  it('按官方规则生成 canonical request、signed headers 与签名', () => {
    const body = 'ParamType=normal&IdentifyNum=310101199001011234&UserName=%E5%BC%A0%E4%B8%89'
    const headers = {
      host: 'cloudauth.aliyuncs.com',
      'content-type': 'application/x-www-form-urlencoded',
      'x-acs-action': 'Id2MetaVerify',
      'x-acs-version': '2019-03-07',
      'x-acs-date': '2026-11-06T06:00:00Z',
      'x-acs-signature-nonce': 'fixed-nonce',
      'x-acs-content-sha256': sha256(body),
    }

    const signed = provider.signRequest({
      method: 'POST',
      path: '/',
      query: '',
      headers,
      body,
      accessKeyId: BASE_SETTINGS.accessKeyId,
      accessKeySecret: BASE_SETTINGS.accessKeySecret,
    })

    expect(signed.signedHeaders).toBe(
      'content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version'
    )
    expect(signed.canonicalRequest.startsWith('POST\n/\n\n')).toBe(true)
    // CanonicalHeaders 以换行结尾，公式再补一个换行 → SignedHeaders 前有空行
    expect(signed.canonicalRequest).toContain(
      '\n\ncontent-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version\n'
    )
    expect(signed.stringToSign).toBe(`ACS3-HMAC-SHA256\n${sha256(signed.canonicalRequest)}`)
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.authorization).toBe(
      `ACS3-HMAC-SHA256 Credential=${BASE_SETTINGS.accessKeyId},SignedHeaders=${signed.signedHeaders},Signature=${signed.signature}`
    )
  })

  it('相同输入得到相同签名，换密钥则签名不同', () => {
    const input = {
      method: 'POST',
      path: '/',
      query: '',
      headers: {
        host: 'cloudauth.aliyuncs.com',
        'x-acs-action': 'Id2MetaVerify',
        'x-acs-version': '2019-03-07',
        'x-acs-date': '2026-11-06T06:00:00Z',
        'x-acs-signature-nonce': 'fixed-nonce',
        'x-acs-content-sha256': sha256(''),
      },
      body: '',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
    }
    const a = provider.signRequest(input)
    const b = provider.signRequest(input)
    const c = provider.signRequest({ ...input, accessKeySecret: 'other' })

    expect(a.signature).toBe(b.signature)
    expect(a.signature).not.toBe(c.signature)
  })
})

describe('Id2MetaVerify 调用与结果映射', () => {
  it('发送 form-urlencoded 参数，BizCode=1 时返回通过', async () => {
    const { fetchImpl, calls } = mockFetch({
      RequestId: 'req-1',
      Code: '200',
      Message: 'success',
      ResultObject: { BizCode: '1' },
    })

    const result = await provider.verify(
      { realName: '张三', idCardNo: VALID_ID },
      {
        settings: BASE_SETTINGS,
        fetchImpl,
        now: new Date('2026-11-06T06:00:00Z'),
        nonce: 'fixed-nonce',
      }
    )

    expect(result).toMatchObject({
      passed: true,
      code: 'MATCHED',
      bizCode: '1',
      requestId: 'req-1',
      provider: 'aliyun',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://cloudauth.aliyuncs.com/')
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].options.headers['x-acs-action']).toBe('Id2MetaVerify')
    expect(calls[0].options.headers['x-acs-version']).toBe('2019-03-07')
    expect(calls[0].options.headers.authorization).toContain('Credential=test-access-key-id')

    const body = new URLSearchParams(calls[0].options.body)
    expect(body.get('ParamType')).toBe('normal')
    expect(body.get('IdentifyNum')).toBe(VALID_ID)
    expect(body.get('UserName')).toBe('张三')
  })

  it.each([
    ['2', 'MISMATCH', '不一致'],
    ['3', 'NOT_FOUND', '未查到'],
  ])('BizCode=%s 映射为 %s', async (bizCode, expectedCode, messagePart) => {
    const { fetchImpl } = mockFetch({
      Code: '200',
      ResultObject: { BizCode: bizCode },
    })

    const result = await provider.verify(
      { realName: '张三', idCardNo: VALID_ID },
      { settings: BASE_SETTINGS, fetchImpl }
    )

    expect(result.passed).toBe(false)
    expect(result.code).toBe(expectedCode)
    expect(result.message).toContain(messagePart)
  })

  it('接口 Code 非 200 时抛服务错误，而不是核验不通过', async () => {
    const { fetchImpl } = mockFetch(
      { Code: 'InvalidAccessKeyId.NotFound', Message: 'Specified access key is not found.' },
      { status: 400, ok: false }
    )

    await expect(
      provider.verify(
        { realName: '张三', idCardNo: VALID_ID },
        { settings: BASE_SETTINGS, fetchImpl }
      )
    ).rejects.toMatchObject({
      name: 'AliyunRealNameError',
      code: 'InvalidAccessKeyId.NotFound',
    })
  })

  it('HTTP 5xx 抛服务错误', async () => {
    const { fetchImpl } = mockFetch('gateway error', { status: 502, ok: false })

    await expect(
      provider.verify(
        { realName: '张三', idCardNo: VALID_ID },
        { settings: BASE_SETTINGS, fetchImpl }
      )
    ).rejects.toMatchObject({ name: 'AliyunRealNameError' })
  })

  it('未配置 AccessKey 时直接拒绝，不发请求', async () => {
    const { fetchImpl, calls } = mockFetch({})

    await expect(
      provider.verify(
        { realName: '张三', idCardNo: VALID_ID },
        { settings: { ...BASE_SETTINGS, accessKeySecret: '' }, fetchImpl }
      )
    ).rejects.toMatchObject({ code: 'CONFIG' })
    expect(calls).toHaveLength(0)
  })

  it('实际发出的请求能被独立的 V3 校验器验证', async () => {
    // 这个用例用真实 Node fetch 打本地 HTTP 服务，按官方规则重新算一遍签名。
    // 它能抓到「签名的头」和「实际发送的头」不一致这类问题 ——
    // 只断言 canonicalRequest 字符串是发现不了的。
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        try {
          const authorization = String(req.headers.authorization || '')
          const match = authorization.match(
            /^ACS3-HMAC-SHA256 Credential=([^,]+),SignedHeaders=([^,]+),Signature=([0-9a-f]{64})$/
          )
          if (!match) throw new Error('authorization 格式不正确')

          const [, credential, signedHeaders, signature] = match
          if (credential !== BASE_SETTINGS.accessKeyId) throw new Error('Credential 不匹配')

          const names = signedHeaders.split(';')
          const canonicalHeaders = names
            .map((name) => `${name}:${String(req.headers[name] || '').trim()}\n`)
            .join('')
          const canonicalRequest = [
            'POST',
            '/',
            '',
            canonicalHeaders,
            signedHeaders,
            sha256(raw),
          ].join('\n')
          const stringToSign = `ACS3-HMAC-SHA256\n${sha256(canonicalRequest)}`
          const expected = crypto
            .createHmac('sha256', BASE_SETTINGS.accessKeySecret)
            .update(stringToSign)
            .digest('hex')

          if (signature !== expected) throw new Error('签名不匹配')
          if (req.headers['x-acs-content-sha256'] !== sha256(raw)) {
            throw new Error('body hash 不匹配')
          }

          const params = new URLSearchParams(raw)
          if (params.get('IdentifyNum') !== VALID_ID) throw new Error('IdentifyNum 不匹配')
          if (params.get('UserName') !== '张三') throw new Error('UserName 不匹配')

          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ Code: '200', ResultObject: { BizCode: '1' } }))
        } catch (err) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ Code: 'SignatureError', Message: err.message }))
        }
      })
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()

    try {
      const result = await provider.verify(
        { realName: '张三', idCardNo: VALID_ID },
        {
          settings: {
            ...BASE_SETTINGS,
            endpoint: `http://127.0.0.1:${port}`,
          },
        }
      )
      expect(result.passed).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
