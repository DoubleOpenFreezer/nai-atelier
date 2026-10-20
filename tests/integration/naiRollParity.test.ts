import { describe, expect, it } from 'vitest';
import { KINDS, constraintsOf, contentRead, contentSnapshotOf } from '../../services/contentRoll';
import type { RollRow } from '../../services/contentRoll';
import { draw, evidenceOf, poolFingerprint, poolOf, replay, rerollOne } from '../../services/contentRollDraw';
import fragment from '../../tools/nai-roll/patches/roll/core.mjs';

/**
 * 产物侧与源码侧的**语义一致性**回归（跨模块）。
 *
 * `tools/nai-roll/patches/roll/core.mjs` 是注入到已发布产物的那份纯逻辑核；
 * `services/contentRoll*.ts` 是从它移植进源码的那一份。两边必须给出同样的结果，
 * 否则「产物上验收过的行为」与「源码里的行为」会悄悄分叉。
 *
 * 这里只依赖纯函数，不需要已安装应用、不需要网络，因此在 CI 里可以常规运行。
 */

/* fragment 是没有类型的 JS，这里统一放宽 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remote = fragment as any;

const chain = (kind: string, index: number) => ({
  id: `${kind}-${index}`, type: kind, name: `${kind} ${index}`,
  basePrompt: `${kind}_${index}_tag, shared_tag`, negativePrompt: '',
  tags: ['基线'], description: '', previewImage: '', updatedAt: 1700000000000 + index,
  params: { _wardrobe: { bilingual: '', facets: { hair: 'blonde', accessory: '__none__', mystery: 'x' } } },
});
const chains = KINDS.flatMap(kind => [3, 1, 2].map(index => chain(kind, index)));

const idsOf = (result: { picks: Record<string, RollRow> }) =>
  Object.fromEntries(KINDS.map(kind => [kind, result.picks[kind]?.id || '']));
const reasonsOf = (result: { picks: Record<string, RollRow> }) =>
  Object.fromEntries(KINDS.map(kind => [kind, result.picks[kind]?.reason || '']));

describe('产物片段与源码服务的语义一致性', () => {
  it('池子与候选池指纹一致', () => {
    for (const kind of KINDS) {
      const mine = poolOf(chains, kind);
      const theirs = remote.poolOf(chains, kind);
      expect(mine.map(item => item.id)).toEqual(theirs.map((item: { id: string }) => item.id));
      expect(poolFingerprint(mine)).toBe(remote.poolFingerprint(theirs));
    }
  });

  it('同随机码抽取逐栏一致（条目与理由）', () => {
    for (const seed of ['r-parity', 'r-parity-2', 'r0']) {
      const mine = draw({ chains, seed });
      const theirs = remote.draw({ chains, seed });
      expect(idsOf(mine)).toEqual(idsOf(theirs));
      expect(reasonsOf(mine)).toEqual(reasonsOf(theirs));
      expect(mine.seeds).toEqual(theirs.seeds);
    }
  });

  it('固定项、未参与、空库三种状态结论一致', () => {
    const input = { chains, seed: 'r-parity', locked: { pose: 'pose-2' }, checks: { camera: false } };
    const mine = draw(input);
    const theirs = remote.draw(input);
    expect(idsOf(mine)).toEqual(idsOf(theirs));
    expect(reasonsOf(mine)).toEqual(reasonsOf(theirs));
    const noCamera = chains.filter(item => item.type !== 'camera');
    expect(reasonsOf(draw({ chains: noCamera, seed: 's' })))
      .toEqual(reasonsOf(remote.draw({ chains: noCamera, seed: 's' })));
  });

  it('单栏重抽与按记录还原一致', () => {
    const mine = draw({ chains, seed: 'r-parity' });
    const theirs = remote.draw({ chains, seed: 'r-parity' });
    const mineReroll = rerollOne({ chains, checks: mine.checks, locked: mine.locked, picks: mine.picks }, 'pose', 'r-next');
    const theirsReroll = remote.rerollOne({ chains, checks: theirs.checks, locked: theirs.locked, picks: theirs.picks }, 'pose', 'r-next');
    expect(mineReroll.ok).toBe(theirsReroll.ok);
    expect(mineReroll.row?.id).toBe(theirsReroll.row.id);

    const mineReplay = replay({ chains }, mine);
    const theirsReplay = remote.replay({ chains }, theirs);
    expect(idsOf(mineReplay)).toEqual(idsOf(theirsReplay));
    expect(mineReplay.restored).toBe(theirsReplay.restored);
    expect(mineReplay.redrawn).toBe(theirsReplay.redrawn);
  });

  it('纯内容快照、白名单读取与四态约束派生一致', () => {
    const mine = draw({ chains, seed: 'r-parity' });
    const theirs = remote.draw({ chains, seed: 'r-parity' });
    const mineSnapshot = contentSnapshotOf(mine, 'T');
    const theirsSnapshot = remote.contentSnapshotOf(theirs, 'T');
    expect(mineSnapshot).toEqual(theirsSnapshot);
    expect(contentRead(mineSnapshot)).toEqual(remote.contentRead(theirsSnapshot));
    for (const entry of chains.slice(0, 6)) {
      expect(constraintsOf(entry)).toEqual(remote.constraintsOf(entry));
    }
    expect(evidenceOf({ ...mine, chains })).toEqual(remote.evidenceOf({ ...theirs, chains }));
  });
});
