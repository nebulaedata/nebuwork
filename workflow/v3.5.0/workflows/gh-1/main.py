def run(ctx):
    ctx.task.save_json("result", ctx.input)
