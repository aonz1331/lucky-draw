# Lucky Draw — Netlify

## โครงสร้าง
- public/index.html            หน้าเว็บ (จอโฮสต์ + หน้าลงทะเบียนมือถือ)
- netlify/functions/api.mjs    API (Netlify Functions + Netlify Blobs)
- netlify.toml / package.json

## Deploy (ต้องใช้ Git หรือ Netlify CLI เพราะมี Functions — การลากไฟล์ไปวางใน Netlify Drop ใช้ไม่ได้)
ทางเลือก A — GitHub: push โฟลเดอร์นี้ขึ้น repo > Netlify: Add new project > Import from Git > Deploy
ทางเลือก B — CLI:  npm i -g netlify-cli && netlify login && netlify deploy --prod

## ตั้งรหัสผู้ดูแล
Netlify > Project configuration > Environment variables > ADMIN_PIN = รหัสที่ต้องการ (ค่าเริ่มต้น 1234) แล้ว Deploy ใหม่

## ใช้งาน
- จอโฮสต์:          https://<ชื่อเว็บ>.netlify.app/
- หน้าลงทะเบียน (QR): https://<ชื่อเว็บ>.netlify.app/r
