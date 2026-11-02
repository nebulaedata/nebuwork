def run(ctx):
    text = ctx.task.read("prepare", "text")
    ctx.task.save_json("counts", {"characters": len(text), "words": len(text.split())})
