export function createWorkbenchEmployee(workbench) {
  const workbenchName = typeof workbench?.name === 'string' ? workbench.name.trim() : '';
  const businessName = workbenchName.replace(/\s*工作台\s*$/u, '').trim() || '本工作台';
  const workbenchId = typeof workbench?.id === 'string' && workbench.id ? workbench.id : 'current';

  return {
    id: `workbench-employee:${workbenchId}`,
    name: `${businessName} AI 员工`,
    initials: 'AI',
    color: workbench?.color || '#6C63F0',
    role: `${workbenchName || '本工作台'}专属 AI 员工`,
  };
}
