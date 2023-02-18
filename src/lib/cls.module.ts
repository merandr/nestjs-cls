import {
    CanActivate,
    DynamicModule,
    Logger,
    MiddlewareConsumer,
    Module,
    NestInterceptor,
    NestModule,
    Provider,
    Type,
    ValueProvider,
} from '@nestjs/common';
import {
    APP_GUARD,
    APP_INTERCEPTOR,
    HttpAdapterHost,
    ModuleRef,
} from '@nestjs/core';
import { ClsServiceManager } from './cls-service-manager';
import {
    CLS_GUARD_OPTIONS,
    CLS_INTERCEPTOR_OPTIONS,
    CLS_MIDDLEWARE_OPTIONS,
    CLS_MODULE_OPTIONS,
    CLS_REQ,
    CLS_RES,
} from './cls.constants';
import { ClsGuard } from './cls.guard';
import { ClsInterceptor } from './cls.interceptor';
import {
    ClsGuardOptions,
    ClsInterceptorOptions,
    ClsMiddlewareOptions,
    ClsModuleAsyncOptions,
    ClsModuleOptions,
} from './cls.options';
import { ClsMiddleware } from './cls.middleware';
import { ClsService } from './cls.service';
import { ProxyProviderManager } from './proxy-provider/proxy-provider-manager';
import { ClsModuleProxyProviderOptions } from './proxy-provider/proxy-provider.interfaces';

const clsServiceProvider: ValueProvider<ClsService> = {
    provide: ClsService,
    useValue: ClsServiceManager.getClsService(),
};

const commonProviders = [
    clsServiceProvider,
    ProxyProviderManager.createProxyProviderFromExistingKey(CLS_REQ),
    ProxyProviderManager.createProxyProviderFromExistingKey(CLS_RES),
];

@Module({
    providers: [...commonProviders],
    exports: [...commonProviders],
})
export class ClsModule implements NestModule {
    constructor(
        private readonly adapterHost: HttpAdapterHost,
        private readonly moduleRef: ModuleRef,
    ) {}

    private static logger = new Logger(ClsModule.name);

    configure(consumer: MiddlewareConsumer) {
        let options: ClsMiddlewareOptions;
        try {
            // if CLS_MIDDLEWARE_OPTIONS provider is available
            // we are running configure, so we mount the middleware
            options = this.moduleRef.get(CLS_MIDDLEWARE_OPTIONS);
        } catch (e) {
            // we are running forFeature import, so do not mount it
            return;
        }

        const adapter = this.adapterHost.httpAdapter;
        let mountPoint = '*';
        if (adapter.constructor.name === 'FastifyAdapter') {
            mountPoint = '(.*)';
        }

        if (options.mount) {
            ClsModule.logger.debug('Mounting ClsMiddleware to ' + mountPoint);
            consumer.apply(ClsMiddleware).forRoutes(mountPoint);
        }
    }

    static forRoot(options?: ClsModuleOptions): DynamicModule {
        options = { ...new ClsModuleOptions(), ...options };
        const { providers, exports } = this.getProviders();
        const proxyProviders = this.createProxyClassProviders(
            options.proxyProviders,
        );

        return {
            module: ClsModule,
            providers: [
                {
                    provide: CLS_MODULE_OPTIONS,
                    useValue: options,
                },
                ...providers,
                ...proxyProviders,
            ],
            exports: [...exports, ...proxyProviders.map((p) => p.provide)],
            global: options.global,
        };
    }

    static forRootAsync(asyncOptions: ClsModuleAsyncOptions): DynamicModule {
        const { providers, exports } = this.getProviders();
        const proxyProviders = this.createProxyClassProviders(
            asyncOptions.proxyProviders,
        );

        return {
            module: ClsModule,
            imports: asyncOptions.imports,
            providers: [
                {
                    provide: CLS_MODULE_OPTIONS,
                    inject: asyncOptions.inject,
                    useFactory: asyncOptions.useFactory,
                },
                ...providers,
                ...proxyProviders,
            ],
            exports: [...exports, ...proxyProviders.map((p) => p.provide)],
            global: asyncOptions.global,
        };
    }

    /**
     * Registers the `ClsService` provider in the module
     */
    static forFeature(): DynamicModule;
    static forFeature(...proxyProviderClasses: Array<Type>): DynamicModule;
    static forFeature(...proxyProviderClasses: Array<Type>): DynamicModule {
        const proxyProviders =
            this.createProxyClassProviders(proxyProviderClasses);
        const providers = [...commonProviders];
        return {
            module: ClsModule,
            providers: [...providers, ...proxyProviders],
            exports: [...providers, ...proxyProviders.map((p) => p.provide)],
        };
    }

    static forFeatureAsync(
        options: ClsModuleProxyProviderOptions,
    ): DynamicModule {
        const proxyProvider = ProxyProviderManager.createProxyProvider(options);
        const providers = [
            ...commonProviders,
            ...(options.extraProviders ?? []),
        ];
        return {
            module: ClsModule,
            imports: options.imports ?? [],
            providers: [...providers, proxyProvider],
            exports: [...commonProviders, proxyProvider.provide],
        };
    }

    private static createProxyClassProviders(
        proxyProviderClasses?: Array<Type>,
    ) {
        return (
            proxyProviderClasses?.map((providerClass) =>
                ProxyProviderManager.createProxyProvider({
                    useClass: providerClass,
                }),
            ) ?? []
        );
    }

    private static getProviders() {
        const providers: Provider[] = [
            ...commonProviders,
            {
                provide: CLS_MIDDLEWARE_OPTIONS,
                inject: [CLS_MODULE_OPTIONS],
                useFactory: this.clsMiddlewareOptionsFactory,
            },
            {
                provide: CLS_GUARD_OPTIONS,
                inject: [CLS_MODULE_OPTIONS],
                useFactory: this.clsGuardOptionsFactory,
            },
            {
                provide: CLS_INTERCEPTOR_OPTIONS,
                inject: [CLS_MODULE_OPTIONS],
                useFactory: this.clsInterceptorOptionsFactory,
            },
        ];
        const enhancerArr: Provider[] = [
            {
                provide: APP_GUARD,
                inject: [CLS_GUARD_OPTIONS],
                useFactory: this.clsGuardFactory,
            },
            {
                provide: APP_INTERCEPTOR,
                inject: [CLS_INTERCEPTOR_OPTIONS],
                useFactory: this.clsInterceptorFactory,
            },
        ];

        return {
            providers: providers.concat(...enhancerArr),
            exports: providers,
        };
    }

    private static clsMiddlewareOptionsFactory(
        options: ClsModuleOptions,
    ): ClsMiddlewareOptions {
        const clsMiddlewareOptions = {
            ...new ClsMiddlewareOptions(),
            ...options.middleware,
        };
        return clsMiddlewareOptions;
    }

    private static clsGuardOptionsFactory(
        options: ClsModuleOptions,
    ): ClsGuardOptions {
        const clsGuardOptions = {
            ...new ClsGuardOptions(),
            ...options.guard,
        };
        return clsGuardOptions;
    }

    private static clsInterceptorOptionsFactory(
        options: ClsModuleOptions,
    ): ClsInterceptorOptions {
        const clsInterceptorOptions = {
            ...new ClsInterceptorOptions(),
            ...options.interceptor,
        };
        return clsInterceptorOptions;
    }

    private static clsGuardFactory(options: ClsGuardOptions): CanActivate {
        if (options.mount) {
            ClsModule.logger.debug('ClsGuard will be automatically mounted');
            return new ClsGuard(options);
        }
        return {
            canActivate: () => true,
        };
    }

    private static clsInterceptorFactory(
        options: ClsInterceptorOptions,
    ): NestInterceptor {
        if (options.mount) {
            ClsModule.logger.debug(
                'ClsInterceptor will be automatically mounted',
            );
            return new ClsInterceptor(options);
        }
        return {
            intercept: (_, next) => next.handle(),
        };
    }
}
