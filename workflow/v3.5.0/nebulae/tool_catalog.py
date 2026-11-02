"""Transport-neutral tool metadata and Pydantic validation."""
import inspect

from pydantic import ConfigDict, create_model


class ToolError(ValueError):
    pass


class ToolCatalog:
    def __init__(self):
        self.entries = {}

    def tool(self, *, annotations):
        def register(function):
            fields = {name: (p.annotation, ... if p.default is inspect.Parameter.empty else p.default)
                      for name, p in inspect.signature(function).parameters.items()}
            model = create_model(function.__name__ + 'Arguments', __config__=ConfigDict(extra='forbid'), **fields)
            self.entries[function.__name__] = {
                'function': function, 'model': model, 'annotations': annotations,
                'name': function.__name__, 'description': inspect.getdoc(function) or function.__name__,
                'parameters': model.model_json_schema(),
            }
            return function
        return register

    def manifest(self):
        return [{key: entry[key] for key in ('name', 'description', 'parameters')} for entry in self.entries.values()]

    def validate(self, name, arguments):
        if name not in self.entries:
            raise ToolError('Unknown Workflow tool')
        return self.entries[name]['model'].model_validate(arguments).model_dump()

    async def call(self, name, arguments):
        return await self.entries[name]['function'](**self.validate(name, arguments))
