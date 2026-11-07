'use strict'

/**
 * 公开存储的目录边界。
 *
 * 头像清理路径曾把用户可写的 `user.avatar` 直接交给 storage.remove()，
 * `../../.env` 这类 key 会逃出 UPLOAD_DIR。这里锁住 remove/read 的包含性校验。
 */

const storage = require('../../src/storage')

describe('storage · 公开上传目录边界', () => {
  it('remove 拒绝删除上传目录之外的文件', async () => {
    await expect(storage.remove('../../etc/passwd')).resolves.toBe(false)
  })

  it('remove 对上传目录内不存在的 key 返回 false，而不是越界', async () => {
    await expect(storage.remove('definitely-missing-inside.txt')).resolves.toBe(false)
  })

  it('read 拒绝读取上传目录之外的文件', async () => {
    await expect(storage.read('../../etc/hostname')).rejects.toThrow('上传存储路径非法')
  })

  it('extractKey 之后仍按上传目录解析', async () => {
    await expect(storage.read('http://example.com/uploads/../outside.txt')).rejects.toThrow(
      '上传存储路径非法'
    )
  })

  it('绝对路径也不能绕过包含性校验', async () => {
    await expect(storage.remove('/etc/passwd')).resolves.toBe(false)
  })
})
