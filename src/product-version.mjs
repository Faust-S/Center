// One displayed release identity from the product package, never an integration gate.
import packageInfo from '../package.json' with {type:'json'};
export const CENTER_PRODUCT_VERSION=packageInfo.version;
