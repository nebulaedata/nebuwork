def run(ctx):
    text = ctx.input.get("text", "Hello Nebulae")
    ctx.task.save_text("text", text)
    ctx.log("输入已准备")
