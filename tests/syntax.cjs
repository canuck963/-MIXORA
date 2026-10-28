const fs=require('fs'),vm=require('vm');for(const file of ['verify-email.html','index.html','Remix.html','remix.html','local-community.html','community.html']){
 const html=fs.readFileSync(file,'utf8');for(const [i,match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries())new vm.Script(match[1],{filename:file+':'+i});
 for(const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g)){const path=match[1];if(!path.startsWith('http')&&!fs.existsSync(path.replace(/^\//,'')))throw Error(file+' missing '+path);}
}for(const file of fs.readdirSync('assets').filter(f=>f.endsWith('.js')))new vm.Script(fs.readFileSync('assets/'+file,'utf8'),{filename:file});console.log('All page scripts parse and local links resolve.');
