/**
 * Whether the database answers, without waiting in the queue the answer is about.
 *
 * Asked through the shared pool, a health check joins the same queue as the work
 * that is keeping the pool busy. A long job holding every connection then reads
 * as "database down" once the wait passes the pool's connection timeout, and the
 * container reads unhealthy while the database is fine. So a pool with no spare
 * connection is skipped for a connection of the check's own. That one still fails
 * when the database is really gone or out of connections, which is the question.
 *
 * Pure: the pool's figures and both ways of asking are passed in.
 */

export interface PoolLoad {
  totalCount: number
  idleCount: number
  waitingCount: number
  max: number
}

export function poolHasSpareConnection(load: PoolLoad): boolean {
  if (load.waitingCount > 0) return false
  return load.idleCount > 0 || load.totalCount < load.max
}

export async function probeDatabase(
  load: PoolLoad,
  askThroughPool: () => Promise<unknown>,
  askOnOwnConnection: () => Promise<unknown>
): Promise<boolean> {
  try {
    await (poolHasSpareConnection(load) ? askThroughPool() : askOnOwnConnection())
    return true
  } catch {
    return false
  }
}
