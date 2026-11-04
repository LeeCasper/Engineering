'use strict'

/**
 * 项目竣工总报告的数据访问层。
 *
 * 一个项目只有一份当前总报告，因此 `project_id` 直接做主键，没有单独的 id。
 * 重新生成会覆盖同一行；历史版本的验收报告仍各自归档，不需要在这里保留版本链。
 */

const db = require('../db/pool')

async function findByProject(projectId) {
  return db.queryOne(
    `SELECT project_id, status, file_url, file_key, sha256, error,
            generated_by, generated_by_type, generated_at, updated_at
       FROM project_completion_report
      WHERE project_id = ?`,
    [projectId]
  )
}

/** 开始生成：只改状态与触发人，不清掉已有文件（正常情况下成功件不会被重新生成） */
async function markPending(projectId, { operatorId, operatorType }) {
  await db.query(
    `INSERT INTO project_completion_report
       (project_id, status, error, generated_by, generated_by_type, generated_at)
     VALUES (?, 'pending', NULL, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       status = 'pending',
       error = NULL,
       generated_by = VALUES(generated_by),
       generated_by_type = VALUES(generated_by_type),
       generated_at = NULL`,
    [projectId, operatorId ?? null, operatorType ?? null]
  )
}

async function markSuccess(projectId, { url, key, sha256 }) {
  await db.query(
    `UPDATE project_completion_report
        SET status = 'success',
            file_url = ?,
            file_key = ?,
            sha256 = ?,
            error = NULL,
            generated_at = NOW()
      WHERE project_id = ?`,
    [url, key, sha256, projectId]
  )
}

async function markFailed(projectId, error) {
  await db.query(
    `UPDATE project_completion_report
        SET status = 'failed',
            error = ?
      WHERE project_id = ?`,
    [String(error || '未知错误').slice(0, 500), projectId]
  )
}

/**
 * 重新生成失败时恢复上一版成功报告。
 *
 * 归档材料不应因为一次「刷新」失败而变得不可下载；错误信息仍保留在 error 里，
 * 前端可以提示「本次更新失败，已保留上一版」。
 */
async function restoreSuccess(projectId, { file_url, file_key, sha256, generated_at }, error) {
  await db.query(
    `UPDATE project_completion_report
        SET status = 'success',
            file_url = ?,
            file_key = ?,
            sha256 = ?,
            error = ?,
            generated_at = ?
      WHERE project_id = ?`,
    [file_url, file_key, sha256, String(error || '').slice(0, 500), generated_at, projectId]
  )
}

module.exports = { findByProject, markPending, markSuccess, markFailed, restoreSuccess }
