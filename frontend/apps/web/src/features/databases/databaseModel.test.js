import { afterEach, expect, it, vi } from 'vitest';
import { databaseRowKey, importTableDefinition, waitDatabaseOperation, blankDatabase } from './databaseModel.js';
afterEach(() => vi.useRealTimers());
it('locates rows only using all declared unique-key fields and preserves large integers', () => {
  const columns = [{ name: 'a' },{ name: 'b' }]; expect(databaseRowKey({ keyColumns: ['a','b'] },columns,['9007199254740993','001'])).toEqual({ a:'9007199254740993', b:'001' });
  expect(databaseRowKey({keyColumns:[]},columns,['x','y'])).toBeNull(); expect(databaseRowKey({keyColumns:['a','b']},columns,['x',null])).toBeNull();
  expect(blankDatabase('mysql').permissions).toEqual({ read:true,write:false,schema:false }); expect(blankDatabase('sqlite').permissions.schema).toBe(true);
  expect(importTableDefinition('t',[{target:'id',type:'text'},{target:'_id',type:'number'}]).columns[0].name).toBe('__id');
});
it('waits for committed results, keeps unknown outcomes and stops after navigation', async () => {
  vi.useFakeTimers(); const controller = new AbortController(), api = { fetchDatabaseOperation:vi.fn().mockResolvedValueOnce({data:{id:'op',state:'running'}}).mockResolvedValueOnce({data:{id:'op',state:'unknown',error:'待核对'}}) };
  const promise = waitDatabaseOperation(api,'db',{id:'op',state:'queued'},controller.signal); await vi.runAllTimersAsync(); expect((await promise).state).toBe('unknown'); expect(api.fetchDatabaseOperation).toHaveBeenCalledTimes(2);
  const second = new AbortController(), stop = waitDatabaseOperation(api,'db',{id:'op',state:'queued'},second.signal); const rejected = expect(stop).rejects.toMatchObject({name:'AbortError'}); second.abort(); await rejected; await vi.runAllTimersAsync(); expect(api.fetchDatabaseOperation).toHaveBeenCalledTimes(2);
});
