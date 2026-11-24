// Approved V8 routes. Root page owns the existing product and native T3 lifecycle.
export type AdminPage='overview'|'context'|'work'|'results'|'people'|'resources'|'programs'|'data';
export const ADMIN_ROUTES={
 overview:{root:'overview',label:'Главная'},
 context:{root:'context',label:'Контекст организации'},
 work:{root:'work',label:'Поручения'},
 results:{root:'results',label:'Результаты'},
 people:{root:'people',label:'Сотрудники и роли'},
 resources:{root:'resources',label:'Планы Atlas'},
 programs:{root:'programs',label:'Personal Agent и лицензии'},
 data:{root:'data',label:'Профиль и данные'},
 'signed-workspace':{root:'results',label:'Workspace T3'},
 'employees-t3':{root:'results',label:'Подключение сотрудника T3'},
 'signed-tasks':{root:'results',label:'Подписанные Task'},
 receive:{root:'results',label:'Получение .iwxa'},
 review:{root:'results',label:'Human Review'},
 apply:{root:'results',label:'Отдельное применение'},
 reuse:{root:'results',label:'Использовать Result'},
 recovery:{root:'results',label:'Восстановление'},
 'atlas-native':{root:'resources',label:'Установленный Atlas'},
 'atlas-file':{root:'resources',label:'Файл Atlas'},
 license:{root:'programs',label:'Лицензии Publisher'},
 'license-age':{root:'programs',label:'Получатель лицензий'},
 'age-exchange':{root:'data',label:'Защищённый обмен'},
 settings:{root:'data',label:'Локальные черновики'},
 guide:{root:'data',label:'Справка'}
} as const satisfies Record<string,{root:AdminPage;label:string}>;
export type AdminRouteId=keyof typeof ADMIN_ROUTES;
export const ADMIN_NAV_GROUPS:Record<AdminPage,readonly AdminRouteId[]>={
 overview:['overview','context'],context:['context','overview'],
 work:['work','resources','signed-tasks'],
 results:['results','signed-workspace','employees-t3','signed-tasks','receive','review','apply','reuse','recovery'],
 people:['people','employees-t3','programs'],
 resources:['resources','atlas-native','atlas-file'],
 programs:['programs','license','license-age','people'],
 data:['data','settings','age-exchange','guide']
};
export const ADMIN_ROUTE_IDS=Object.keys(ADMIN_ROUTES) as AdminRouteId[];
export const routeRoot=(route:AdminRouteId):AdminPage=>ADMIN_ROUTES[route].root;
// Root retains the complete workbench. Focused routes reveal the original
// working regions without remounting components or copying signed state.
export const routeAllows=(route:AdminRouteId,...sections:AdminRouteId[])=>
 route===routeRoot(route)||sections.includes(route);
export function visibleAdminRoutes(page:AdminPage,query:string):AdminRouteId[]{
 const needle=query.trim().toLocaleLowerCase('ru');
 return needle?ADMIN_ROUTE_IDS.filter(id=>ADMIN_ROUTES[id].label.toLocaleLowerCase('ru').includes(needle)):
  [...ADMIN_NAV_GROUPS[page]];
}
