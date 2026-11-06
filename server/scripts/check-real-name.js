#!/usr/bin/env node
'use strict'

/**
 * 阿里云实名认证连通性检查。
 *
 * 不要把真实姓名 / 身份证号直接写在命令行参数里（会进 shell history）；
 * 用环境变量传入：
 *
 *   REAL_NAME_TEST_NAME=张三 REAL_NAME_TEST_ID=310101199001011234 \
 *     node scripts/check-real-name.js
 *
 * 输出只包含是否通过、业务码与 RequestId，不回显证件号。
 * 这是运维排障脚本，不会被业务代码调用。
 */

const config = require('../config')
const provider = require('../src/services/realName/aliyun.provider')

const realName = process.env.REAL_NAME_TEST_NAME
const idCardNo = process.env.REAL_NAME_TEST_ID

if (!realName || !idCardNo) {
  console.error('用法：REAL_NAME_TEST_NAME=姓名 REAL_NAME_TEST_ID=身份证号 node scripts/check-real-name.js')
  process.exit(1)
}

if (config.realName.provider !== 'aliyun') {
  console.error(
    `当前 REAL_NAME_PROVIDER=${config.realName.provider}，请先设置为 aliyun 并配置 AccessKey`
  )
  process.exit(1)
}

provider
  .verify({ realName, idCardNo })
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          passed: result.passed,
          code: result.code,
          bizCode: result.bizCode,
          requestId: result.requestId,
          message: result.message,
        },
        null,
        2
      )
    )
    process.exit(result.passed ? 0 : 2)
  })
  .catch((err) => {
    console.error(JSON.stringify({ code: err.code || 'ERROR', message: err.message }, null, 2))
    process.exit(1)
  })
