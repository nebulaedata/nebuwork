import { describe, expect, it } from 'vitest';
import { createWorkbenchEmployee } from './workbenchEmployee.js';

describe('createWorkbenchEmployee', () => {
  it('creates one named AI employee from the current workbench', () => {
    expect(createWorkbenchEmployee({ id: 'wb-doc', name: '文件审查工作台', color: '#123456' })).toEqual({
      id: 'workbench-employee:wb-doc',
      name: '文件审查 AI 员工',
      initials: 'AI',
      color: '#123456',
      role: '文件审查工作台专属 AI 员工',
    });
  });

  it('never falls back to an unspecified question-mark employee', () => {
    const employee = createWorkbenchEmployee();
    expect(employee.name).toBe('本工作台 AI 员工');
    expect(employee.initials).toBe('AI');
    expect(employee.name).not.toContain('未指定');
    expect(employee.initials).not.toBe('?');
  });
});
