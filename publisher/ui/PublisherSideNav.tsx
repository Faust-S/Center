import React from 'react';
import type {Page} from './PublisherDashboard';

type Item={label:string;page:Page;anchor?:string};
const pages:Record<Page,{caption:string;description:string;items:Item[]}>={
 overview:{caption:'Главная',description:'Ваши виджеты и основные действия',items:[
  {label:'Конструктор дашборда',page:'overview'},
  {label:'Лицензия организации',page:'proposals'},
  {label:'Резервные копии',page:'overview',anchor:'publisher-preparation-backup'},
  {label:'Диагностика',page:'overview',anchor:'publisher-diagnostics'}]},
 products:{caption:'Продукты',description:'Каталог и связанные процессы',items:[
  {label:'Каталог продуктов',page:'products',anchor:'publisher-product-workspace'},
  {label:'Создать продукт',page:'products',anchor:'publisher-product-save-action'},
  {label:'Тарифы продукта',page:'tariffs'},
  {label:'Предложения',page:'proposals'},
  {label:'Проверка релиза',page:'releases'}]},
 tariffs:{caption:'Тарифы и лимиты',description:'Редакции, функции и квоты',items:[
  {label:'Редактирование тарифа',page:'tariffs',anchor:'publisher-tariffs'},
  {label:'Ресурсные квоты',page:'tariffs',anchor:'publisher-quota-editor'},
  {label:'Подготовить лицензию',page:'proposals'},
  {label:'Клиенты',page:'holders'}]},
 holders:{caption:'Клиенты',description:'Организации и PERSON',items:[
  {label:'Создать получателя',page:'holders',anchor:'publisher-client-save-action'},
  {label:'Корпоративные лицензии',page:'proposals'},
  {label:'Выдача исходным T3',page:'trust'}]},
 proposals:{caption:'Лицензии',description:'Подготовка, подпись, STATUS',items:[
  {label:'Подготовить по тарифу',page:'proposals',anchor:'publisher-tariff-proposal'},
  {label:'Условия организации',page:'proposals',anchor:'publisher-corporate-offer-reviews'},
  {label:'ISSUE и STATUS',page:'trust',anchor:'publisher-corporate-native-owner'},
  {label:'Лицензии PERSON',page:'trust',anchor:'publisher-person-owner'},
  {label:'TEST и совместимость',page:'proposals',anchor:'publisher-legacy-save-action'}]},
 releases:{caption:'Релизы',description:'Реальные байты и источники',items:[
  {label:'Сравнение двух копий',page:'releases',anchor:'publisher-offline-copies'},
  {label:'Проверить файл сборки',page:'releases'},
  {label:'Записи файлов',page:'releases'},
  {label:'Обмен .iwxa',page:'trust'}]},
 trust:{caption:'Доверие и ключи',description:'Оригинальный T3 и передача',items:[
  {label:'Корпоративный Owner',page:'trust',anchor:'publisher-corporate-native-owner'},
  {label:'Выдача PERSON',page:'trust',anchor:'publisher-person-owner'},
  {label:'Подписанный журнал',page:'trust',anchor:'publisher-t3-owner-panel'},
  {label:'Зашифрованная передача age',page:'trust',anchor:'publisher-age-exchange'},
  {label:'Пакет .iwxa',page:'trust',anchor:'publisher-select-test-iwxa'}]},
 settings:{caption:'Настройки',description:'Рабочее пространство и программа',items:[
  {label:'Версия и параметры',page:'settings',anchor:'publisher-settings'},
  {label:'Настроить главную',page:'overview'},
  {label:'Диагностика и Setup Core',page:'overview',anchor:'publisher-diagnostics'},
  {label:'Резервные копии',page:'overview',anchor:'publisher-preparation-backup'}]}
};
export function PublisherSideNav({page,onNavigate,onLibrary}:{page:Page;
 onNavigate:(page:Page,anchor?:string)=>void;onLibrary:()=>void}){
 const current=pages[page];
 return <aside className="pub-side-context" data-testid="publisher-section-navigation">
  <header className="pub-side-context-head">
   <h2>{current.caption}</h2><p>{current.description}</p>
  </header>
  <nav aria-label="Действия раздела Publisher">
   <div className="pub-side-caption">В этом разделе</div>
   {current.items.map(item=><button key={item.label} type="button"
     aria-label={'Перейти к '+item.label}
     onClick={()=>item.label==='Конструктор дашборда'?onLibrary():
       onNavigate(item.page,item.anchor)}>{item.label}</button>)}
  </nav>
  <div className="pub-side-context-foot">
   <strong>Исходный T3</strong>
   <p>Подписание и права получателя не возникают из локальной подготовки.</p>
  </div>
 </aside>;
}
