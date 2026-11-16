from app.database import build_postgres_engine_kwargs


def test_postgres_pool_fits_supabase_session_limits():
    kwargs = build_postgres_engine_kwargs("postgresql+psycopg://u:p@host:5432/postgres")
    assert kwargs["pool_size"] == 3
    assert kwargs["max_overflow"] == 4
    assert "prepare_threshold" not in kwargs["connect_args"]


def test_transaction_pooler_port_disables_prepared_statements():
    kwargs = build_postgres_engine_kwargs("postgresql+psycopg://u:p@host:6543/postgres")
    assert kwargs["connect_args"]["prepare_threshold"] is None
