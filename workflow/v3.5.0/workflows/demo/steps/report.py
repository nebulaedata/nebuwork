import json


def run(ctx):
    report = {
        "text": ctx.task.read("uppercase", "text"),
        **ctx.task.read("count", "counts"),
    }
    report_path = ctx.work_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    ctx.task.save_json("report", report)
    artifact_id = ctx.task.save_file("report-file", report_path)
    ctx.workflow.save_json("latest-report", report)
    ctx.emit("message", {"text": "报告生成完成", "artifact_id": artifact_id})
