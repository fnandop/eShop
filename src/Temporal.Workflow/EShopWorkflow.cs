using Temporalio.Common;
using Temporalio.Workflows;


namespace Temporal.Workflow
{
    [Workflow]
    public partial class EShopWorkflow
    {

        int _orderId = default;
        private PaymentStatus _paymentStatus = PaymentStatus.Unknown;


        [WorkflowRun]
        public async Task RunAsync(OrderRequest orderRequest)
        {

            // Retry policy
            var retryPolicy = new RetryPolicy
            {
                InitialInterval = TimeSpan.FromSeconds(1),
                MaximumInterval = TimeSpan.FromSeconds(100),
                BackoffCoefficient = 2,
                MaximumAttempts = 3,
                NonRetryableErrorTypes = new[] { "InvalidAccountException", "InsufficientFundsException" }
            };

            _orderId = await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                (EShopActivities act) => act.CreateOrder(orderRequest),
                new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });


            //Grace period
            await Temporalio.Workflows.Workflow.DelayAsync(TimeSpan.FromSeconds(5));

            await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                (EShopActivities act) => act.SetAwaitingValidation(_orderId),
                new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });

            var checkStockResult = await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                (EShopActivities act) => act.CheckStock(_orderId, orderRequest.Items),
                new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });

            if (checkStockResult.StockConfirmed)
                await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                    (EShopActivities act) => act.ConfirmThatHasStock(_orderId),
                    new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });
            else
            {
                await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                    (EShopActivities act) => act.ConfirmThatHasNoStock(_orderId, checkStockResult.OrderStockItems.Select(i => new IOrderService.ConfirmedOrderStockItem(i.ProductId, i.HasStock))),
                    new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });
                return;
            }

            await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
             (EShopActivities act) => act.InitiatePaymentAsync(_orderId, orderRequest.OrderyGuid),
             new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });

            // Wait for purchase
            await Temporalio.Workflows.Workflow.WaitConditionAsync(() => _paymentStatus != PaymentStatus.Unknown);

            if (_paymentStatus == PaymentStatus.Succeeded)
            {
                // Payment succeeded logic
                await Temporalio.Workflows.Workflow.ExecuteActivityAsync((EShopActivities act) => act.SetPaidOrderStatus(_orderId),
                       new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });

                await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                    (EShopActivities act) => act.RemoveStock(_orderId, orderRequest.Items),
                    new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });
            }
            else if (_paymentStatus == PaymentStatus.Failed)
            {
                await Temporalio.Workflows.Workflow.ExecuteActivityAsync((EShopActivities act) => act.CancelOrder(_orderId),
                       new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5), RetryPolicy = retryPolicy });

            }
        }

        [WorkflowSignal("NotifyOrderPaymentSucceeded")]
        public async Task NotifyOrderPaymentSucceededAsync() => _paymentStatus = PaymentStatus.Succeeded;

        [WorkflowSignal("NotifyOrderPaymentFailed")]
        public async Task NotifyOrderPaymentFailedAsync() => _paymentStatus = PaymentStatus.Failed;
    }
}
