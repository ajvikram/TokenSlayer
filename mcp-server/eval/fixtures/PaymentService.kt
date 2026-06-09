package com.example.payments

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

enum class PaymentStatus { PENDING, AUTHORIZED, CAPTURED, FAILED, REFUNDED }

data class Payment(
    val id: UUID,
    val orderId: UUID,
    val amount: BigDecimal,
    val currency: String,
    val status: PaymentStatus,
    val createdAt: Instant
)

interface PaymentGateway {
    fun authorize(amount: BigDecimal, currency: String): String
    fun capture(authorizationId: String): Boolean
    fun refund(authorizationId: String, amount: BigDecimal): Boolean
}

@Service
class PaymentService @Autowired constructor(
    private val gateway: PaymentGateway,
    private val repository: PaymentRepository
) {

    fun authorizePayment(orderId: UUID, amount: BigDecimal, currency: String): Payment {
        val authId = gateway.authorize(amount, currency)
        val payment = Payment(
            id = UUID.randomUUID(),
            orderId = orderId,
            amount = amount,
            currency = currency,
            status = PaymentStatus.AUTHORIZED,
            createdAt = Instant.now()
        )
        repository.save(payment, authId)
        return payment
    }

    fun capturePayment(paymentId: UUID): Payment {
        val payment = repository.findById(paymentId)
            ?: throw IllegalArgumentException("Payment not found: $paymentId")
        val authId = repository.findAuthIdFor(paymentId)
            ?: throw IllegalStateException("Missing auth id for $paymentId")
        val ok = gateway.capture(authId)
        val newStatus = if (ok) PaymentStatus.CAPTURED else PaymentStatus.FAILED
        return repository.updateStatus(paymentId, newStatus)
    }

    fun refundPayment(paymentId: UUID, amount: BigDecimal): Boolean {
        val authId = repository.findAuthIdFor(paymentId) ?: return false
        val ok = gateway.refund(authId, amount)
        if (ok) {
            repository.updateStatus(paymentId, PaymentStatus.REFUNDED)
        }
        return ok
    }
}
