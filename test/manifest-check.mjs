import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/ze/.dsh/profiles/desktop/node_modules/')
const yaml = require('js-yaml')
const root = 'D:/zhuomian/测试/dsh-session-delete'
const patch = yaml.load(await readFile(root + '/cordis.patch.yml', 'utf8'))
const pkg = JSON.parse(await readFile(root + '/package.json', 'utf8'))
const zh = JSON.parse(await readFile(root + '/locale/zh.json', 'utf8'))
const en = JSON.parse(await readFile(root + '/locale/en.json', 'utf8'))
console.log(JSON.stringify({ patchRows: patch.length, insertId: patch[0].insert[0].id, name: patch[0].insert[0].name, pkg: pkg.name, hasBundle: !!pkg.dsh.bundle, hasClient: !!pkg.dsh.client, zhTitle: zh.meta.title, enTitle: en.meta.title }))