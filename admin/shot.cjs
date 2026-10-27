const puppeteer = require('puppeteer-core')
const fs = require('fs')

;(async () => {
  const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(f => fs.existsSync(f))
  const browser = await puppeteer.launch({ executablePath: edge, headless: 'new', args: ['--window-size=1440,900'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })

  await page.goto('http://127.0.0.1:5342/admin', { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForSelector('#lu')
  await page.type('#lu', 'admin')
  await page.type('#lp', 'ChangeMe123!')
  await page.screenshot({ path: 'C:\\Users\\hawdi\\AppData\\Local\\Temp\\opencode\\admin_login_stage.png' })
  await Promise.all([
    page.waitForSelector('.shell', { timeout: 15000 }).catch(() => null),
    page.click('.login-card .btn-primary'),
  ])
  const errTxt = await page.$eval('.login-card .err', el => el.textContent).catch(() => '')
  if (errTxt) console.log('LOGIN ERR:', errTxt)
  if (await page.$('.shell')) console.log('shell present')
  await new Promise(r => setTimeout(r, 1200))
  const shot = n => page.screenshot({ path: `C:\\Users\\hawdi\\AppData\\Local\\Temp\\opencode\\admin_${n}.png`, fullPage: false })

  await shot('overview')

  const railBtns = await page.$$('.rail-btn')
  await railBtns[1].click()
  await new Promise(r => setTimeout(r, 1200))
  await shot('catalog')

  // open a software detail + the config dialog
  const rows = await page.$$('.mrow')
  if (rows.length) { await rows[rows.length - 1].click(); await new Promise(r => setTimeout(r, 1200)) }
  await shot('catalog_detail')

  const railBtns2 = await page.$$('.rail-btn')
  await railBtns2[2].click()
  await new Promise(r => setTimeout(r, 1200))
  await shot('licenses')

  const railBtns3 = await page.$$('.rail-btn')
  await railBtns3[3].click()
  await new Promise(r => setTimeout(r, 1200))
  await shot('audit')

  console.log('OK')
  await browser.close()
})().catch(e => { console.log('ERR', e.message); process.exit(1) })
