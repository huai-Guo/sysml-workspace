class ModelGatewayError(RuntimeError):
    """Base error for model access."""


class ModelConfigurationError(ModelGatewayError):
    """Invalid or incomplete model configuration."""


class ModelTransportError(ModelGatewayError):
    """Network/transport failure while talking to a provider."""


class ModelTimeoutError(ModelTransportError):
    """The provider request exceeded its configured timeout."""


class ModelProviderError(ModelGatewayError):
    """Provider returned a non-success HTTP response."""


class ModelResponseError(ModelGatewayError):
    """Provider response could not be normalized into ModelResponse."""
