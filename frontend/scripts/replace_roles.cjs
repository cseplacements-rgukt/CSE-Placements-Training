const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.js') || file.endsWith('.jsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const srcDir = path.join(__dirname, '../src');
const files = walk(srcDir);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace role checks like "teacher" with "tnpc_admin"
  let newContent = content.replace(/"teacher"/g, '"tnpc_admin"');
  newContent = newContent.replace(/'teacher'/g, "'tnpc_admin'");
  newContent = newContent.replace(/Teacher/g, "TNPC Admin");
  newContent = newContent.replace(/teacher/g, "tnpc_admin");
  
  if (content !== newContent) {
    fs.writeFileSync(file, newContent);
    console.log(`Updated ${file}`);
  }
}
