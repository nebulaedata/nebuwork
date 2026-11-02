import { describe, it, expect } from 'vitest';
import { usageText, sumUsage, dailyUsage, usageTrend, taskDistribution } from './usage.js';

describe('durable Token consumption presentation',()=>{
  it('keeps measured zero, unknown, partial and unavailable distinct',()=>{
    expect(usageText({totalTokens:0,usageKnown:true})).toBe('0 Tokens');
    expect(usageText({totalTokens:null,usageKnown:false})).toBe('用量未知');
    expect(usageText({totalTokens:100,usageKnown:false})).toBe('已记录 100 Tokens，部分用量未知');
    expect(usageText({unavailable:true,totalTokens:0})).toBe('统计暂不可用');
    expect(sumUsage([{totalTokens:100,callCount:1,usageKnown:true},{totalTokens:null,callCount:1,usageKnown:false}])).toMatchObject({totalTokens:100,usageKnown:false,callCount:2});
    expect(sumUsage([{totalTokens:10},{unavailable:true}])).toMatchObject({unavailable:true,totalTokens:null});
    expect(sumUsage([]).totalTokens).toBe(0);
  });
  it('combines project days without double counting caches or inventing unknown totals',()=>{
    const daily=dailyUsage([{daily:[{date:'2026-10-16',totalTokens:100,cacheReadTokens:20,usageKnown:true}]},{daily:[{date:'2026-10-16',totalTokens:50,usageKnown:true},{date:'2026-10-15',totalTokens:null,usageKnown:false}]}]);
    expect(daily.map(d=>d.totalTokens)).toEqual([null,150]);
    expect(daily[1].cacheReadTokens).toBe(20);
    expect(usageTrend({unavailable:true})).toContain('暂不可用');
    expect(taskDistribution([{status:'completed'},{status:'cancelled'},{status:'completed'}])).toContain('2 个');
    expect(taskDistribution([{status:'completed'}])).toContain('已完成');
  });
});
