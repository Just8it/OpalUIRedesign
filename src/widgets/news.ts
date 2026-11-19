import { scrapePortlet } from './news-scraper';
export function scrapeNews() {
    const portlet = document.querySelector('div[data-portlet-order="InfoMessages"] section.panel.portlet');
    return portlet ? scrapePortlet(portlet, 'news') : [];
}
