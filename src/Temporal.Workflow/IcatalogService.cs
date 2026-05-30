using Refit;


namespace Temporal.Workflow
{
    public interface ICatalogService
    {
        public record CheckStockResult(int OrderId, bool StockConfirmed, List<ConfirmedOrderStockItem> OrderStockItems);
        public record ConfirmedOrderStockItem(int ProductId, bool HasStock);
        public record OrderStockItem(int ProductId, int Units);
        public record CheckStockRequest(int OrderId, IEnumerable<OrderStockItem> OrderStockItems);
        public record RemoveStockRequest(IEnumerable<OrderStockItem> OrderStockItems);

        [Post("/api/catalog/check-stock?api-version=1.0")]
        Task<CheckStockResult> CheckStock(CheckStockRequest checkStockRequest);

        [Post("/api/catalog/remove-stock?api-version=1.0")]
        Task RemoveStock(RemoveStockRequest removeStockRequest);
    }
}
