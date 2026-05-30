using Temporalio.Activities;
using Temporalio.Client;
using Temporalio.Workflows;

namespace PaymentProcessor
{

    /// <summary>
    /// This workflow simulates the delay between the payment session start and the payment confirmation.
    /// It could alternatively be implemented as a child workflow of the main <see cref="EShopWorkflow"/>.
    /// </summary>
    [Workflow]
    public class PaymentWorkflowMockDelay
    {



        [WorkflowRun]
        public async Task RunAsync(int OrderId, string orderyGuid)
        {

            // Simulate payment processing delay, between checkout and the callback from the payment service.
            await Temporalio.Workflows.Workflow.DelayAsync(TimeSpan.FromSeconds(5));

            // After the delay, simulate a callback from the payment service by signaling the main workflow.
            // Similar to https://docs.stripe.com/payments/checkout/how-checkout-works?payment-ui=stripe-hosted#complete-transaction
            await Temporalio.Workflows.Workflow.ExecuteActivityAsync(
                            (PaymentWorkflowMockDelayActivities act) => act.NotifyOrderPaymentResult(OrderId, orderyGuid),
                            new ActivityOptions { StartToCloseTimeout = TimeSpan.FromMinutes(5) });
        }
    }

    public class PaymentWorkflowMockDelayActivities
    {


        readonly ITemporalClient _temporalClient;
        readonly IOptionsMonitor<PaymentOptions> _options;
        readonly ILogger<PaymentWorkflowMockDelay> _logger;
        public PaymentWorkflowMockDelayActivities(ITemporalClient temporalClient,
                                        IOptionsMonitor<PaymentOptions> options,
                                        ILogger<PaymentWorkflowMockDelay> logger)
        {
            _temporalClient = temporalClient;
            _options = options;
            _logger = logger;
        }



        [Activity]
        public async Task NotifyOrderPaymentResult(int OrderId, string orderyGuid)
        {
            var handle = _temporalClient.GetWorkflowHandle(orderyGuid);

            if (_options.CurrentValue.PaymentSucceeded)
            {
                _logger.LogInformation("Payment succeeded for OrderId: {OrderId}, signaling workflow.", OrderId);
                await handle.SignalAsync("NotifyOrderPaymentSucceeded", []);


            }
            else
            {
                _logger.LogWarning("Payment failed for OrderId: {OrderId}, signaling workflow.", OrderId);
                await handle.SignalAsync("NotifyOrderPaymentFailed", []);
            }
        }
    }
}
