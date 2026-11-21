// Read-only, ephemeral manager projection of ONE currently selected organization.
// Every row links back to its owning editor or original observed source.
// This is neither a knowledge graph, authorization registry, nor an additional Store.
const fold = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru')
  .replaceAll('ё','е').replace(/\s+/g,' ').trim();

export function buildManagerContext(organization, atlasView = null) {
  if (!organization || typeof organization.id !== 'string') return [];
  const rows = [];
  const add = (kind, id, title, summary, source, fields = '') => {
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title) return;
    rows.push({kind, id, title, summary, source,
      searchText: fold([title, summary, fields, id].join(' '))});
  };
  add('organization', organization.id, organization.name,
    'Выбранная организация. Сведения о составе пока являются локальными черновиками.',
    'Черновик Admin Center');
  for (const space of organization.workspaces ?? []) {
    add('workspace', space.id, space.name,
      space.atlasRef
        ? 'Рабочая область. Подготовлена ссылка на Atlas, её актуальность требует проверки.'
        : 'Рабочая область без обязательной связи с Atlas.',
      'Черновик Admin Center', space.atlasRef?.projectId);
  }
  for (const person of organization.participants ?? []) {
    add('person', person.id, person.name,
      [person.roleLabel || 'Функция не указана',
       'Контакт из черновика, не подтверждённые права.',
       person.personalAgentPlan === 'PLANNED'
         ? 'Место Personal Agent запланировано, лицензия не выдана.' : ''].filter(Boolean).join(' '),
      'Черновик Admin Center');
  }
  for (const task of organization.assignments ?? []) {
    const person = (organization.participants ?? []).find(p => p.id === task.assigneeId);
    const reviewer = (organization.participants ?? []).find(p => p.id === task.reviewerId);
    const space = (organization.workspaces ?? []).find(w => w.id === task.workspaceId);
    add('assignment', task.id, task.title,
      ['Черновик, не подписанное поручение.',
       person ? 'Исполнитель: ' + person.name : 'Исполнитель не назначен.',
       space ? 'Рабочая область: ' + space.name : '',
       task.dueDate ? 'Плановая дата: ' + task.dueDate : ''].filter(Boolean).join(' '),
      'Черновик Admin Center',
      [task.description, task.criteria, reviewer?.name, task.atlasRef?.projectId, task.atlasRef?.workId].join(' '));
  }
  // Atlas entries are a read-only observation only when the selected
  // organization has an explicitly opened native/file Atlas source.
  if (atlasView && Array.isArray(atlasView.projects)) {
    const source = atlasView.mode === 'NATIVE_ATLAS_PUBLIC_READ_ONLY'
      ? 'Последнее чтение установленного Atlas, не права T3'
      : 'Открытая копия Atlas, не синхронизация';
    for (const project of atlasView.projects) {
      add('atlas-project', project.id, project.name,
        'Проект Atlas, редакция наблюдения ' + String(atlasView.revision ?? 'не указана') + '.',
        source, [project.owner, project.status].join(' '));
      for (const work of project.workItems ?? []) {
        add('atlas-work', work.id, work.title,
          'Работа Atlas в проекте «' + project.name + '». Состояние плана: ' +
           String(work.state ?? 'не указано') + '.',
          source, [project.name, work.dueDate, work.priority].join(' '));
      }
    }
  }
  return rows;
}

export function searchManagerContext(rows, query, limit = 16) {
  const tokens = fold(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter(row => tokens.every(token => row.searchText.includes(token)))
    .map(row => ({
      row, score: tokens.reduce((value, token) =>
        value + (fold(row.title).includes(token) ? 4 : 1), 0)
        + (row.kind === 'assignment' ? 1 : 0)
    }))
    .sort((a,b) => b.score - a.score || a.row.title.localeCompare(b.row.title, 'ru'))
    .slice(0, Math.max(0, Math.min(40, limit)))
    .map(hit => hit.row);
}

export function managerAttention(organization, {today = '', atlasStatus = null} = {}) {
  if (!organization) return [];
  const items = [];
  const add = (key, title, detail, destination, assignmentId = null) =>
    items.push({key, title, detail, destination, assignmentId});
  if (!(organization.workspaces ?? []).length) {
    add('workspace', 'Добавить рабочую область',
      'Это первый шаг. Для обычных поручений Atlas необязателен.', 'resources');
  } else if (!(organization.participants ?? []).length) {
    add('people', 'Добавить участников',
      'Контакт в черновике не создаёт корпоративных полномочий.', 'people');
  } else if (!(organization.assignments ?? []).length) {
    add('assignment', 'Подготовить первое поручение',
      'Укажите результат и критерии приёмки.', 'work');
  }
  for (const task of organization.assignments ?? []) {
    if (!task.assigneeId) {
      add('assignee:' + task.id, 'Выбрать исполнителя: ' + task.title,
        'У черновика пока нет назначенного исполнителя.', 'work', task.id);
    }
    if (today && task.dueDate && task.dueDate < today) {
      add('date:' + task.id, 'Проверить срок черновика: ' + task.title,
        'Указанная в черновике дата уже прошла. Это не подтверждённая просрочка выданной Task.',
        'work', task.id);
    }
    if (task.atlasRef && typeof atlasStatus === 'function') {
      const status = atlasStatus(task.atlasRef);
      if (status !== 'SOURCE_REVISION_MATCHES' && status !== 'NOT_OBSERVED') {
        add('atlas:' + task.id, 'Проверить связь Atlas: ' + task.title,
          'Наблюдаемая редакция или работа отличается от ссылки в черновике.',
          'resources');
      }
    }
  }
  return items.slice(0, 12);
}
