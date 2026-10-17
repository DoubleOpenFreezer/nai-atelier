// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetTagDictionaryCache, searchArtistDictionary } from '../../services/tagDictionary';

const manifest = {
  version: 1,
  generatedAt: 'gen-a',
  count: 1,
  categoryCounts: { artist: 1 },
  categories: {},
  shards: { as: 'shard-as.json' },
  chineseShards: {},
  popular: {},
  popularArtists: [],
  artistPageSize: 500,
  artistPages: [],
  artistNamePages: [],
  popularCharacters: [],
  characterPageSize: 500,
  characterPages: [],
  characterNamePages: [],
  characterSearchShardCount: 0,
  characterSearchShards: [],
  characterSearchRecords: '',
};
const respond = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload }) as Response;
const stubSearch = () => vi.stubGlobal('fetch', vi.fn((url: string) => String(url).includes('manifest.json')
  ? Promise.resolve(respond(manifest))
  : Promise.resolve(respond([['ask_(askzy)', '画师甲', 1, 100, 0]]))));

beforeEach(() => { vi.unstubAllGlobals(); resetTagDictionaryCache(); });
afterEach(() => { vi.unstubAllGlobals(); resetTagDictionaryCache(); });

it('复制带下划线的完整画师 Tag 仍能按前缀搜索', async () => {
  stubSearch();
  const rows = await searchArtistDictionary('ask_(askzy)');
  expect(rows.map(row => row.name)).toEqual(['ask_(askzy)']);
});

it('把下划线写成空格后仍能命中带括号的画师名', async () => {
  stubSearch();
  const rows = await searchArtistDictionary('ask (askzy)');
  expect(rows.map(row => row.name)).toEqual(['ask_(askzy)']);
});
