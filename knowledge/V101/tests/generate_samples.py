"""Generate disposable documents/media using the real runtime toolchain."""
from pathlib import Path
import subprocess
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from PIL import Image, ImageDraw, ImageFont

root=Path('/tmp/nebulaekno-fixtures');root.mkdir(exist_ok=True)
(root/'sample.md').write_text('# NebulaeKno\nNebulaeKno 使用数据库管理知识。\n## 数据库初始化\n首次启动创建数据库和表。😀\n',encoding='utf-8')
doc=Document();doc.add_heading('数据库初始化',0);doc.add_heading('第一章',1);doc.add_paragraph('NebulaeKno 使用数据库管理知识。');doc.save(root/'sample.docx')
subprocess.run(['libreoffice','-env:UserInstallation=file:///tmp/fixture-office','--headless','--convert-to','pdf','--outdir',str(root),str(root/'sample.docx')],check=True)
book=Workbook();sheet=book.active;sheet['A1']='数据库';sheet['C1']=0.25;sheet['C1'].number_format='0.00%';book.save(root/'sample.xlsx')
deck=Presentation();slide=deck.slides.add_slide(deck.slide_layouts[0]);slide.shapes.title.text='数据库初始化';slide.placeholders[1].text='NebulaeKno 使用数据库管理知识。';deck.save(root/'sample.pptx')
image=Image.new('RGB',(800,400),'#e9f9ef');draw=ImageDraw.Draw(image);font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',48);draw.text((40,120),'NebulaeKno 数据库',font=font,fill='#102c1b');image.save(root/'sample.png')
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=3','-ar','16000',str(root/'sample.wav')],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=green:s=320x240:d=3','-i',str(root/'sample.wav'),'-c:v','libx264','-c:a','aac','-shortest','-movflags','+faststart',str(root/'sample.mp4')],check=True)
print(root)
