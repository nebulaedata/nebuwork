def run(ctx):
    ctx.progress(50, "正在转换文本")
    ctx.task.save_text("text", ctx.task.read("prepare", "text").upper())
