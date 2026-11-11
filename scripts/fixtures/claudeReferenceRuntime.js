const attrsBefore = new WeakMap();
class DCLogic {
 constructor() { this.state = {}; }
 setState(change) { Object.assign(this.state, change); renderReference(this); }
}
function resolveValue(path, values) {
 path=path.trim();if(path==='true')return true;if(path==='false')return false;
 if(!/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(path))throw Error('Unexpected template path '+path);
 return path.split('.').reduce((value,key)=>value?.[key],values);
}
function interpolate(text, values) { return text.replace(/{{\s*([^}]+)\s*}}/g,(_,path)=>String(resolveValue(path,values)??'')); }
function buildNode(node, values) {
 if(node.nodeType===Node.TEXT_NODE)return [document.createTextNode(interpolate(node.textContent,values))];
 if(node.nodeType!==Node.ELEMENT_NODE)return [node.cloneNode(false)];
 if(node.localName==='sc-if')return resolveValue(node.getAttribute('value').replace(/{{|}}/g,''),values)?[...node.childNodes].flatMap(child=>buildNode(child,values)):[];
 if(node.localName==='sc-for'||node.hasAttribute('data-reference-for'))return (resolveValue(node.getAttribute('list').replace(/{{|}}/g,''),values)||[]).flatMap(item=>[...(node.content?.childNodes||node.childNodes)].flatMap(child=>buildNode(child,{...values,[node.getAttribute('as')]:item})));
 const result=node.cloneNode(false);
 for(const attr of [...result.attributes]){
  if(attr.name.startsWith('hint-')){result.removeAttribute(attr.name);continue;}
  if(attr.name.startsWith('on')){
   const fn=resolveValue(attr.value.replace(/{{|}}/g,''),values);result.removeAttribute(attr.name);
   result[attr.name==='onchange'?'oninput':attr.name]=fn;continue;
  }
  if(['hidden','open','disabled'].includes(attr.name)&&attr.value.includes('{{')){
   if(resolveValue(attr.value.replace(/{{|}}/g,''),values))result.setAttribute(attr.name,'');else result.removeAttribute(attr.name);continue;
  }
  result.setAttribute(attr.name,interpolate(attr.value,values));
 }
 if(result.localName==='img')result.setAttribute('src','/demo/faq-ilustracion.jpg');
 [...node.childNodes].flatMap(child=>buildNode(child,values)).forEach(child=>result.append(child));
 return [result];
}
function remember(node){if(node.nodeType===1)attrsBefore.set(node,new Map([...node.attributes].map(x=>[x.name,x.value])));node.childNodes.forEach(remember);}
function morph(node, next){
 if(node.nodeType!==next.nodeType||node.nodeName!==next.nodeName){const fresh=next.cloneNode(true);node.replaceWith(fresh);remember(fresh);morph(fresh,next);return;}
 if(node.nodeType===3){if(node.textContent!==next.textContent)node.textContent=next.textContent;return;}
 if(node.nodeType!==1)return;
 const previous=attrsBefore.get(node)||new Map();const current=new Map([...next.attributes].map(x=>[x.name,x.value]));
 for(const key of previous.keys())if(!current.has(key))node.removeAttribute(key);
 for(const [key,value]of current)if(previous.get(key)!==value)node.setAttribute(key,value);
 attrsBefore.set(node,current);
 for(const handler of ['onclick','oninput','onsubmit'])node[handler]=next[handler];
 if(node.localName==='input'&&node.value!==next.getAttribute('value'))node.value=next.getAttribute('value')||'';
 for(let i=0;i<next.childNodes.length;i++){
  if(!node.childNodes[i]){const fresh=next.childNodes[i].cloneNode(true);node.append(fresh);remember(fresh);}
  morph(node.childNodes[i],next.childNodes[i]);
 }
 while(node.childNodes.length>next.childNodes.length)node.lastChild.remove();
}
function renderReference(component){
 const template=document.querySelector('#reference-template');const next=buildNode(template.content.firstElementChild,component.renderVals())[0];
 const root=document.querySelector('#reference-root');if(!root.firstChild){root.append(next);remember(next);}else morph(root.firstChild,next);
}
// SOURCE_COMPONENT is appended by the test server, reviewed and confined to this isolated origin.
