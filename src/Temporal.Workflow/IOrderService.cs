using Refit;

namespace Temporal.Workflow;

public interface IOrderService
{
    [Post("/api/orders/create?api-version=1.0")]
    Task<int> CreateOrderAsync(OrderRequest orderRequest, [Header("x-requestid")] string requestId);

    [Patch("/api/orders/{orderId}/awaiting-validation?api-version=1.0")]
    Task SetAwaitingValidation(int orderId);

    [Patch("/api/orders/{orderId}/confirm-stock?api-version=1.0")]
    Task ConfirmStockAsync(int orderId);

    [Patch("/api/orders/{orderId}/stock-rejected?api-version=1.0")]
    Task ConfirmStockRejectedAsync(int orderId, [Body] IEnumerable<ConfirmedOrderStockItem> orderStockItems);
    public record ConfirmedOrderStockItem(int ProductId, bool HasStock);

    [Patch("/api/orders/{orderId}/paid?api-version=1.0")]
    Task SetPaidOrderStatusAsync(int orderId);

    [Patch("/api/orders/{orderId}/cancel?api-version=1.0")]
    Task CancelOrderAsync(int orderId);
}



